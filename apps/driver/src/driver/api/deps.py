from typing import TYPE_CHECKING, Annotated, cast

from fastapi import Depends, Request

from driver.db.database import Database
from driver.pipeline.run_manager import RunManager
from driver.settings import DriverSettings

if TYPE_CHECKING:
    from driver.app import Services


def _services(request: Request) -> Services:
    return cast('Services', request.app.state.services)


def get_runs(request: Request) -> RunManager:
    return _services(request).runs


def get_db(request: Request) -> Database:
    return _services(request).db


def get_settings(request: Request) -> DriverSettings:
    return _services(request).settings


Runs = Annotated[RunManager, Depends(get_runs)]
Db = Annotated[Database, Depends(get_db)]
Settings = Annotated[DriverSettings, Depends(get_settings)]
