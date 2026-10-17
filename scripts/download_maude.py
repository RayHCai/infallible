"""Download the full openFDA device/event bulk export into data/maude/raw/{export_date}/.

Resumable: finished files are skipped; re-run to retry failures.
"""

import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import httpx

RAW_ROOT = Path(__file__).resolve().parents[1] / 'data' / 'maude' / 'raw'


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix('.part')
    with httpx.stream('GET', url, timeout=120, follow_redirects=True) as r:
        r.raise_for_status()
        with tmp.open('wb') as fh:
            for chunk in r.iter_bytes(1 << 20):
                fh.write(chunk)
    tmp.replace(dest)


def main() -> None:
    manifest = httpx.get('https://api.fda.gov/download.json', timeout=60).json()
    event = manifest['results']['device']['event']

    # Each export gets its own directory so a newer one never mixes with an older one.
    raw_dir = RAW_ROOT / event['export_date']
    raw_dir.mkdir(parents=True, exist_ok=True)
    (raw_dir / 'manifest.json').write_text(json.dumps(event, indent=2))

    dests = {p['file']: raw_dir / p['file'].split('/device/event/')[1] for p in event['partitions']}
    todo = {url: dest for url, dest in dests.items() if not dest.exists()}
    print(f'export {event["export_date"]}: {len(todo)} of {len(dests)} files to fetch')

    failed = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(download, url, dest): url for url, dest in todo.items()}
        for i, fut in enumerate(as_completed(futures), 1):
            try:
                fut.result()
            except httpx.HTTPError as e:
                failed.append(futures[fut])
                print(f'failed {futures[fut]}: {e}')
            if i % 25 == 0 or i == len(futures):
                print(f'{i}/{len(futures)} done, {len(failed)} failed')

    if failed:
        raise SystemExit(f'{len(failed)} files failed; re-run to retry')


if __name__ == '__main__':
    main()
