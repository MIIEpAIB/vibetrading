"""Compatibility shim for the optional ``pika`` dependency."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class PlainCredentials:
    username: str
    password: str


class ConnectionParameters:
    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = 5672,
        virtual_host: str = "/",
        credentials: PlainCredentials | None = None,
        **kwargs: Any,
    ) -> None:
        self.host = host
        self.port = port
        self.virtual_host = virtual_host
        self.credentials = credentials
        self.kwargs = dict(kwargs)
        for key, value in kwargs.items():
            setattr(self, key, value)


class BasicProperties:
    def __init__(self, **kwargs: Any) -> None:
        self.__dict__.update(kwargs)


class _Method:
    def __init__(self, queue: str = "") -> None:
        self.queue = queue


class _QueueDeclareResult:
    def __init__(self, queue: str = "") -> None:
        self.method = _Method(queue)


class Channel:
    def __init__(self) -> None:
        self.is_open = True

    def queue_declare(self, queue: str = "", **kwargs: Any) -> _QueueDeclareResult:
        return _QueueDeclareResult(queue or "qa.queue")

    def exchange_declare(self, *args: Any, **kwargs: Any) -> None:
        return None

    def basic_publish(self, *args: Any, **kwargs: Any) -> bool:
        return True

    def confirm_delivery(self) -> None:
        return None

    def queue_bind(self, *args: Any, **kwargs: Any) -> None:
        return None

    def basic_consume(self, *args: Any, **kwargs: Any) -> None:
        return None

    def start_consuming(self) -> None:
        return None

    def close(self) -> None:
        self.is_open = False


class BlockingConnection:
    def __init__(self, parameters: ConnectionParameters, *args: Any, **kwargs: Any) -> None:
        self.parameters = parameters
        self.is_open = True
        self._channel = Channel()

    def channel(self, channel_number: int | None = None) -> Channel:
        return self._channel

    def close(self) -> None:
        self.is_open = False
        self._channel.close()
        return None


__all__ = [
    "BasicProperties",
    "BlockingConnection",
    "Channel",
    "ConnectionParameters",
    "PlainCredentials",
]
