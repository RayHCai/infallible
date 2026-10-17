import argparse
import logging

import uvicorn

from firmware.host.app import create_app
from firmware.host.settings import HostSettings


def main() -> None:
    parser = argparse.ArgumentParser(description='Run the pump emulator host.')
    parser.add_argument('--spawn', type=int, default=0, help='Pre-start N pumps for manual use.')
    args = parser.parse_args()

    settings = HostSettings()
    logging.basicConfig(
        level=settings.log_level, format='%(asctime)s %(levelname)s %(name)s %(message)s'
    )
    uvicorn.run(
        create_app(settings, spawn=args.spawn),
        host=settings.host,
        port=settings.port,
        access_log=False,
    )


if __name__ == '__main__':
    main()
