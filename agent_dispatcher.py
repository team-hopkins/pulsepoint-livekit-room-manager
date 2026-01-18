import asyncio
import logging
import subprocess
import os
from typing import Dict, Optional

logger = logging.getLogger("agent-dispatcher")


class AgentDispatcher:
    def __init__(self):
        self.active_agents: Dict[str, subprocess.Popen] = {}
        
    async def spawn_agent_for_room(self, room_name: str) -> bool:
        if room_name in self.active_agents:
            logger.info(f"Agent already running for room: {room_name}")
            return True
            
        try:
            logger.info(f"Spawning medical note agent for room: {room_name}")
            
            env = os.environ.copy()
            env["LIVEKIT_URL"] = os.getenv("LIVEKIT_URL")
            env["LIVEKIT_API_KEY"] = os.getenv("LIVEKIT_API_KEY")
            env["LIVEKIT_API_SECRET"] = os.getenv("LIVEKIT_API_SECRET")
            env["OPENAI_API_KEY"] = os.getenv("OPENAI_API_KEY")
            env["DEEPGRAM_API_KEY"] = os.getenv("DEEPGRAM_API_KEY")
            
            process = subprocess.Popen(
                ["python", "agent.py", "connect", "--room", room_name],
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True
            )
            
            self.active_agents[room_name] = process
            logger.info(f"Agent spawned successfully for room: {room_name}")
            
            asyncio.create_task(self._monitor_agent(room_name, process))
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to spawn agent for room {room_name}: {e}")
            return False
    
    async def _monitor_agent(self, room_name: str, process: subprocess.Popen):
        try:
            stdout, stderr = await asyncio.get_event_loop().run_in_executor(
                None, process.communicate
            )
            
            if stdout:
                logger.info(f"Agent {room_name} output: {stdout}")
            if stderr:
                logger.error(f"Agent {room_name} error: {stderr}")
                
        except Exception as e:
            logger.error(f"Error monitoring agent {room_name}: {e}")
        finally:
            if room_name in self.active_agents:
                del self.active_agents[room_name]
                logger.info(f"Agent removed from active agents: {room_name}")
    
    async def stop_agent_for_room(self, room_name: str) -> bool:
        if room_name not in self.active_agents:
            logger.warning(f"No active agent found for room: {room_name}")
            return False
            
        try:
            process = self.active_agents[room_name]
            process.terminate()
            
            try:
                await asyncio.wait_for(
                    asyncio.get_event_loop().run_in_executor(None, process.wait),
                    timeout=5.0
                )
            except asyncio.TimeoutError:
                process.kill()
                await asyncio.get_event_loop().run_in_executor(None, process.wait)
            
            del self.active_agents[room_name]
            logger.info(f"Agent stopped for room: {room_name}")
            return True
            
        except Exception as e:
            logger.error(f"Error stopping agent for room {room_name}: {e}")
            return False
    
    def get_active_agents(self) -> list:
        return list(self.active_agents.keys())


agent_dispatcher = AgentDispatcher()
