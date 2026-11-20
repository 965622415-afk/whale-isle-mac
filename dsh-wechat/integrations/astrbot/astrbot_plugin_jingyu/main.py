import asyncio
import hashlib
import json

import aiohttp
from astrbot.api import AstrBotConfig
from astrbot.api.event import AstrMessageEvent, filter
from astrbot.api.message_components import At, Plain
from astrbot.api.star import Context, Star, register


ENDPOINT = "http://127.0.0.1:18429/api/group/reply"


@register("astrbot_plugin_jingyu", "鲸屿", "把白名单群里的点名消息交给鲸屿", "1.0.0")
class JingyuGroup(Star):
    def __init__(self, context: Context, config: AstrBotConfig):
        super().__init__(context)
        self.config = config

    @filter.event_message_type(filter.EventMessageType.GROUP_MESSAGE, priority=10)
    async def reply_to_mention(self, event: AstrMessageEvent):
        key = self.config.get("shared_key", "").strip()
        group_id = str(event.get_group_id() or "")
        platform_id = str(event.get_platform_id() or "")
        allowed = self.config.get("group_ids", [])
        required_platform = self.config.get("adapter_id", "").strip()
        if not key or not group_id or group_id not in allowed:
            return
        if required_platform and required_platform != platform_id:
            return

        bot_id = str(event.get_self_id() or "")
        if not bot_id or str(event.get_sender_id()) == bot_id:
            return
        parts = event.get_messages()
        if not any(isinstance(part, At) and str(part.qq) == bot_id for part in parts):
            return
        text = "".join(part.text for part in parts if isinstance(part, Plain)).strip()
        message_id = str(getattr(event.message_obj, "message_id", "") or "")
        if not text or not message_id:
            return

        unique = json.dumps([platform_id, group_id, message_id]).encode("utf-8")
        group = getattr(event.message_obj, "group", None)
        payload = {
            "id": "astrbot-" + hashlib.sha256(unique).hexdigest(),
            "groupId": group_id,
            "groupName": getattr(group, "group_name", None) or group_id,
            "text": text,
        }
        try:
            async with aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=90), trust_env=False
            ) as client:
                async with client.post(
                    ENDPOINT,
                    json=payload,
                    headers={"Authorization": f"Bearer {key}"},
                    allow_redirects=False,
                ) as response:
                    if not 200 <= response.status < 300:
                        return
                    result = await response.json()
        except (aiohttp.ClientError, asyncio.TimeoutError, ValueError):
            return

        reply = result.get("text") if isinstance(result, dict) else None
        if isinstance(reply, str) and reply.strip():
            yield event.plain_result(reply)
            event.stop_event()
