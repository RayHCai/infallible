import json
import shutil
from typing import Annotated
from uuid import NAMESPACE_URL, UUID, uuid5

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from serial.tools import list_ports

from driver.api.deps import Db, Firmware, Runs, Settings
from driver.object_builder import Capture
from infallible_contracts import (
    Agent,
    BuildAccepted,
    ConnectRequest,
    ConnectResponse,
    Device,
    DriverMessage,
    MeshAnnotations,
    Persona,
    Run,
    RunListing,
    StartResponse,
    StopRequest,
    SuggestionsFile,
    Task,
)
from infallible_contracts.loaders import load_personas, load_tasks
from infallible_contracts.paths import DataLayout

router = APIRouter()

_IMAGE_SUFFIX = {'image/jpeg': '.jpg', 'image/png': '.png', 'image/heic': '.heic'}
_MESH_SUFFIX = {'model/vnd.usdz+zip': '.usdz', 'model/obj': '.obj', 'model/gltf-binary': '.glb'}


# --------------------------------------------------------------------------- #
# Pipeline                                                                    #
# --------------------------------------------------------------------------- #
@router.post('/start', status_code=status.HTTP_201_CREATED)
async def start(runs: Runs) -> StartResponse:
    return await runs.start()


@router.post('/stop')
async def stop(body: StopRequest, runs: Runs) -> Run:
    return await runs.stop(body.run_id)


@router.post('/build', status_code=status.HTTP_202_ACCEPTED)
async def build(
    runs: Runs,
    settings: Settings,
    run_id: Annotated[UUID, Form()],
    frames: Annotated[list[UploadFile], File(description='Captured frames (JPEG/PNG/HEIC).')],
    poses: Annotated[str | None, Form(description='JSON array of per-frame camera poses.')] = None,
    scale: Annotated[float | None, Form(gt=0, description='Metres per unit, if known.')] = None,
    mesh: Annotated[UploadFile | None, File(description='On-device mesh (USDZ/OBJ/GLB).')] = None,
) -> BuildAccepted:
    if not frames and mesh is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, 'frames or mesh required')
    if len(frames) > settings.max_upload_frames:
        raise HTTPException(
            status.HTTP_413_CONTENT_TOO_LARGE, f'max {settings.max_upload_frames} frames'
        )

    parsed_poses = json.loads(poses) if poses else None
    if parsed_poses is not None and not isinstance(parsed_poses, list):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, 'poses must be a JSON array')

    capture_dir = DataLayout(settings.data_dir).capture_dir(run_id)
    capture_dir.mkdir(parents=True, exist_ok=True)
    # Never trust client filenames: name files by index + declared content type.
    frame_paths = []
    for i, upload in enumerate(frames):
        path = capture_dir / f'frame_{i:03d}{_IMAGE_SUFFIX.get(upload.content_type or "", ".jpg")}'
        with path.open('wb') as out:
            shutil.copyfileobj(upload.file, out)
        frame_paths.append(path)
    mesh_path = None
    if mesh is not None:
        mesh_path = capture_dir / f'device_mesh{_MESH_SUFFIX.get(mesh.content_type or "", ".bin")}'
        with mesh_path.open('wb') as out:
            shutil.copyfileobj(mesh.file, out)

    await runs.accept_build(
        run_id, Capture(frames=frame_paths, poses=parsed_poses, scale_m=scale, mesh=mesh_path)
    )
    return BuildAccepted(run_id=run_id, frames_received=len(frame_paths))


@router.post('/runs/{run_id}/skip-scan', status_code=status.HTTP_202_ACCEPTED)
async def skip_scan(run_id: UUID, runs: Runs) -> BuildAccepted:
    # An empty capture makes the builder install the bundled fallback mesh.
    await runs.accept_build(run_id, Capture(frames=[]))
    return BuildAccepted(run_id=run_id, frames_received=0)


@router.post('/connect')
async def connect(body: ConnectRequest, runs: Runs) -> ConnectResponse:
    return await runs.connect(body.device_id)


@router.get('/devices')
async def devices(firmware: Firmware) -> list[Device]:
    # Stable id across polls/replugs: derived from the port's hardware id.
    serial = [
        Device(id=uuid5(NAMESPACE_URL, p.hwid), name=p.description or p.device, port=p.device)
        for p in list_ports.comports()
    ]
    host = await firmware.device()
    return [host, *serial] if host else serial


# --------------------------------------------------------------------------- #
# Read models                                                                 #
# --------------------------------------------------------------------------- #
@router.get('/runs')
async def list_runs(db: Db) -> list[RunListing]:
    return await db.list_runs()


@router.get('/runs/{run_id}')
async def get_run(run_id: UUID, db: Db) -> Run:
    run = await db.get_run(run_id)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, 'run not found')
    return run


@router.get('/runs/{run_id}/agents')
async def get_agents(run_id: UUID, db: Db) -> list[Agent]:
    return await db.list_agents(run_id)


@router.get('/runs/{run_id}/mesh', response_class=FileResponse)
async def get_mesh(run_id: UUID, settings: Settings) -> FileResponse:
    path = DataLayout(settings.data_dir).mesh(run_id)
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, 'mesh not built yet')
    return FileResponse(path, media_type='model/gltf-binary')


@router.get('/runs/{run_id}/mesh/annotations')
async def get_mesh_annotations(run_id: UUID, settings: Settings) -> MeshAnnotations:
    path = DataLayout(settings.data_dir).mesh_annotations(run_id)
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, 'mesh not built yet')
    return MeshAnnotations.model_validate_json(path.read_bytes())


@router.get('/runs/{run_id}/suggestions')
async def get_suggestions(run_id: UUID, settings: Settings) -> SuggestionsFile:
    path = DataLayout(settings.data_dir).suggestions(run_id)
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, 'suggestions not ready')
    return SuggestionsFile.model_validate_json(path.read_bytes())


@router.get('/runs/{run_id}/replay')
async def replay(run_id: UUID, runs: Runs) -> list[DriverMessage]:
    return await runs.replay(run_id)


@router.get('/personas')
async def get_personas(settings: Settings) -> list[Persona]:
    return list(load_personas(DataLayout(settings.data_dir).personas_dir).values())


@router.get('/tasks')
async def get_tasks(settings: Settings) -> list[Task]:
    return load_tasks(DataLayout(settings.data_dir).tasks_dir)
