import logging

import uvicorn

from firmware.host.app import create_app
from firmware.host.settings import HostSettings


def main() -> None:
    settings = HostSettings()
    logging.basicConfig(
        level=settings.log_level, format='%(asctime)s %(levelname)s %(name)s %(message)s'
    )
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port, access_log=False)


if __name__ == '__main__':
    main()
