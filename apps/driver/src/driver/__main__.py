import logging

import uvicorn

from driver.app import create_app
from driver.settings import get_settings


def main() -> None:
    settings = get_settings()
    logging.basicConfig(
        level=settings.log_level, format='%(asctime)s %(levelname)s %(name)s %(message)s'
    )
    uvicorn.run(
        create_app(settings), host=settings.host, port=settings.port, ws='websockets-sansio'
    )


if __name__ == '__main__':
    main()
