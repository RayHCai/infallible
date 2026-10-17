"""Talks to the firmware host (Raspberry Pi or the compose `firmware` service)."""

from typing import TYPE_CHECKING
from uuid import NAMESPACE_URL, uuid5

import httpx

from infallible_contracts import AllocateRequest, AllocateResponse, Device, ReleaseRequest

if TYPE_CHECKING:
    from uuid import UUID

    from driver.settings import FirmwareMode

LOCAL_ENDPOINT = 'local'


class FirmwareHostClient:
    def __init__(self, mode: FirmwareMode, base_url: str, timeout_s: float = 30.0) -> None:
        self._mode = mode
        self._http = httpx.AsyncClient(base_url=base_url, timeout=timeout_s)
        self.device_id = uuid5(NAMESPACE_URL, base_url)

    async def device(self) -> Device | None:
        """The firmware host as a selectable pump, if it's reachable."""
        if self._mode == 'local':
            return None
        try:
            resp = await self._http.get('/healthz', timeout=1.0)
            resp.raise_for_status()
        except httpx.HTTPError:
            return None
        name = resp.json().get('name', 'firmware host')
        return Device(
            id=self.device_id, name=f'Pump emulator ({name})', port=str(self._http.base_url)
        )

    async def allocate(self, run_id: UUID, n: int) -> list[str]:
        if self._mode == 'local':
            return [LOCAL_ENDPOINT] * n
        resp = await self._http.post(
            '/allocate', json=AllocateRequest(run_id=run_id, n=n).model_dump(mode='json')
        )
        resp.raise_for_status()
        return AllocateResponse.model_validate_json(resp.content).endpoints

    async def release(self, run_id: UUID) -> None:
        if self._mode == 'local':
            return
        resp = await self._http.post(
            '/release', json=ReleaseRequest(run_id=run_id).model_dump(mode='json')
        )
        resp.raise_for_status()

    async def aclose(self) -> None:
        await self._http.aclose()
