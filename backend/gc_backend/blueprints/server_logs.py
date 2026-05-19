"""
Server log streaming endpoints.

The stream is intentionally created per connected UI client: no queue, sink, or
backend-to-frontend transmission exists until the "Terminal serveur" widget opens
an EventSource connection.
"""

import json
import queue
import threading
import traceback
from typing import Any, Dict, Optional

from flask import Blueprint, Response, request, stream_with_context
from loguru import logger


bp = Blueprint("server_logs", __name__, url_prefix="/api/server-logs")

VALID_LEVELS = {"TRACE", "DEBUG", "INFO", "SUCCESS", "WARNING", "ERROR", "CRITICAL"}


class LogStreamSubscriber:
    """Small per-client queue used as a temporary loguru sink."""

    def __init__(self, max_queue_size: int = 1000):
        self.queue: "queue.Queue[Dict[str, Any]]" = queue.Queue(maxsize=max_queue_size)
        self._lock = threading.Lock()
        self._sequence = 0
        self._dropped = 0

    def __call__(self, message: Any) -> None:
        payload = self._to_payload(message)
        self._offer(payload)

    def _to_payload(self, message: Any) -> Dict[str, Any]:
        record = message.record
        with self._lock:
            self._sequence += 1
            sequence = self._sequence
            dropped = self._dropped
            self._dropped = 0

        source = record["extra"].get("source")
        if not source:
            source = f"{record['name']}:{record['function']}:{record['line']}"

        payload: Dict[str, Any] = {
            "id": sequence,
            "timestamp": record["time"].isoformat(),
            "level": record["level"].name,
            "source": source,
            "message": record["message"],
            "thread": record["thread"].name,
        }

        exception = record.get("exception")
        if exception:
            payload["exception"] = "".join(
                traceback.format_exception(exception.type, exception.value, exception.traceback)
            )

        if dropped:
            payload["dropped"] = dropped

        return payload

    def _offer(self, payload: Dict[str, Any]) -> None:
        try:
            self.queue.put_nowait(payload)
            return
        except queue.Full:
            pass

        try:
            self.queue.get_nowait()
            with self._lock:
                self._dropped += 1
        except queue.Empty:
            pass

        try:
            self.queue.put_nowait(payload)
        except queue.Full:
            with self._lock:
                self._dropped += 1


def _normalize_level(raw_level: Optional[str]) -> str:
    level = (raw_level or "INFO").strip().upper()
    return level if level in VALID_LEVELS else "INFO"


def _sse(event: str, data: Dict[str, Any], event_id: Optional[Any] = None) -> str:
    lines = []
    if event_id is not None:
        lines.append(f"id: {event_id}")
    lines.append(f"event: {event}")
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    for line in payload.splitlines():
        lines.append(f"data: {line}")
    return "\n".join(lines) + "\n\n"


@bp.route("/stream", methods=["GET"])
def stream_server_logs() -> Response:
    level = _normalize_level(request.args.get("level"))
    subscriber = LogStreamSubscriber()

    @stream_with_context
    def generate():
        sink_id: Optional[int] = None
        try:
            sink_id = logger.add(
                subscriber,
                level=level,
                format="{message}",
                enqueue=False,
                backtrace=False,
                diagnose=False,
            )
            yield _sse("connected", {"level": level})

            while True:
                try:
                    payload = subscriber.queue.get(timeout=15)
                    yield _sse("log", payload, payload.get("id"))
                except queue.Empty:
                    yield _sse("heartbeat", {})
        except GeneratorExit:
            pass
        finally:
            if sink_id is not None:
                try:
                    logger.remove(sink_id)
                except ValueError:
                    pass

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
