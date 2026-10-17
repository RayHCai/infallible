import argparse
import asyncio
import logging
from pathlib import Path

from firmware.emulator.config import load_config
from firmware.emulator.server import EmulatorServer


def main() -> None:
    parser = argparse.ArgumentParser(description='Run one isolated pump emulator instance.')
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, required=True)
    parser.add_argument('--config', type=Path, default=None, help='Pump config YAML.')
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(name)s %(message)s')
    server = EmulatorServer(load_config(args.config))
    asyncio.run(server.serve(args.host, args.port))


if __name__ == '__main__':
    main()
