from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Any, Dict
from datetime import datetime, timezone
import os
from dotenv import load_dotenv
import uvicorn
import aiohttp
import asyncio
import logging
import glob
from pathlib import Path

# Load environment variables
load_dotenv()

# Read environment variables
CLIENT_ID = os.getenv("CLIENT_ID", "default_client")
LLM_NOTIFICATION_ENDPOINT = os.getenv(
    "LLM_NOTIFICATION_ENDPOINT", ""
)
BACKEND_HOST = os.getenv("BACKEND_HOST", "0.0.0.0")
BACKEND_PORT = int(os.getenv("BACKEND_PORT", 8000))
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:4200").split(",")
TIMEOUT = int(os.getenv("TIMEOUT", 30))
DEBUG_MODE = os.getenv("DEBUG_MODE", "False").lower() == "true"
MAIN_PROMPTS_DIRECTORY = os.environ.get('MAIN_PROMPTS_DIRECTORY', 'prompts/')
SUBPROMPTS_DIRECTORY = os.environ.get('SUBPROMPTS_DIRECTORY', 'subprompts/')

# Configure logging
logging.basicConfig(level=logging.DEBUG if DEBUG_MODE else logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# Add CORS middleware configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory storage for simplicity
conversation_history = []
connected_clients = []

# Global counter for assigning unique message IDs
message_counter = 0  # Initialized to 0

# Create a global aiohttp session
session: aiohttp.ClientSession = None

# Startup event to initialize aiohttp session
@app.on_event("startup")
async def startup_event():
    global session
    session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=TIMEOUT))
    logger.info("Aiohttp session initialized")

# Shutdown event to close aiohttp session
@app.on_event("shutdown")
async def shutdown_event():
    global session
    if session:
        await session.close()
        logger.info("Aiohttp session closed")


# For generating unique thread IDs
def generate_thread_id():
    current_timestamp = datetime.now(timezone.utc).timestamp()
    thread_id = "{:.4f}".format(current_timestamp)
    return thread_id

thread_id = generate_thread_id()

class PromptData(BaseModel):
    prompt_type: str
    prompt_name: Optional[str] = None
    prompt_content: str

class Message(BaseModel):
    channel_id: int
    event_type: str
    response_id: int
    text: Optional[str] = ""
    thread_id: str
    timestamp: str
    user_email: str
    user_id: int
    user_name: str
    reaction_name: Optional[str] = None
    files_content: List[Any] = []
    images: List[Any] = []
    is_mention: bool
    origin_plugin_name: str
    message_type: Optional[str] = None
    is_internal: bool = False
    raw_data: Dict[str, Any]
    username: str
    event_label: str
    api_app_id: str
    app_id: str

@app.post("/api/send_message")
async def send_message(request: Request):
    global conversation_history, message_counter
    try:
        message_data = await request.json()
        text = message_data.get("text", "")
        thread_id = message_data.get("thread_id", generate_thread_id())

        logger.info("Received message on /api/send_message")

        # Increment message counter and assign an ID
        message_counter += 1
        user_message = {
            "id": message_counter,
            "role": "user",
            "content": text,
            "is_internal": False,
            "reactions": [],
            "user_name": message_data.get("user_name", "User"),
            "timestamp": message_data.get("timestamp", datetime.now(timezone.utc).timestamp()),
            "thread_id": thread_id,
            "event_type": message_data.get("event_type", "MESSAGE"),  # Ensure event_type is set
        }
        conversation_history.append(user_message)

        # Broadcast user message to connected WebSocket clients
        await send_message_to_clients(user_message)

        # Call external program to process user message asynchronously
        asyncio.create_task(call_llm_backend(message_data))

        return {"status": "Message received", "message_id": message_counter}
    except Exception as e:
        logger.error(f"Error in send_message endpoint: {str(e)}")
        return {"status": "ERROR", "message": str(e)}


async def send_message_to_clients(message: Dict):
    """
    This function sends the message to all connected WebSocket clients. 
    It ensures that the message has the necessary fields like event_type.
    """
    # Ensure event_type is present in the message
    if 'event_type' not in message:
        logger.warning("Missing event_type in message, setting to 'MESSAGE'")
        message['event_type'] = 'MESSAGE'  # Default to 'MESSAGE' if not specified

    if connected_clients:
        await asyncio.gather(*(connection.send_json(message) for connection in connected_clients))


async def call_llm_backend(message_payload):  
    global session  
    headers = {"Content-Type": "application/json"}  
    try:  
        async with session.post(LLM_NOTIFICATION_ENDPOINT, headers=headers, json=message_payload) as response:  
            if response.status in [200, 202]:  
                logger.info("Message accepted by LLM backend.")  
            else:  
                logger.error(f"Failed to send message to LLM backend: {response.status}")  
                # Send error message to connected clients  
                error_message = {  
                    "event_type": "ERROR",  
                    "error": f"Failed to send message to external API. Status code: {response.status}"  
                }  
                await send_message_to_clients(error_message)  
    except asyncio.TimeoutError:  
        logger.error("Timeout while sending message to LLM backend.")  
        # Send error message to connected clients  
        error_message = {  
            "event_type": "ERROR",  
            "error": "Timeout while connecting to the external API."  
        }  
        await send_message_to_clients(error_message)  
    except Exception as e:  
        logger.error(f"Error during LLM backend interaction: {str(e)}")  
        # Send error message to connected clients  
        error_message = {  
            "event_type": "ERROR",  
            "error": f"Error during LLM backend interaction: {str(e)}"  
        }  
        await send_message_to_clients(error_message)  


@app.post("/api/receive_message")
async def receive_message(request: Request):
    global conversation_history, message_counter
    try:
        message_data = await request.json()
        event_type = message_data.get("event_type", "MESSAGE")  # Default to MESSAGE if not provided
        text = message_data.get("text", "")
        reaction_name = message_data.get("reaction_name", "")
        is_internal = message_data.get("is_internal", False)
        files_content = message_data.get("files_content", [])
        message_type = message_data.get("message_type", "text")
        logger.info(f"Received message on /api/receive_message: {event_type} reaction name: {reaction_name}")
        message_counter += 1

        timestamp = message_data.get("timestamp", datetime.now(timezone.utc).timestamp())
        thread_id = message_data.get("thread_id", "default_thread")

        # Handle regular text messages
        if event_type == "MESSAGE":
            assistant_message = {
                "id": message_counter,
                "role": "assistant_internal" if is_internal else "assistant",
                "content": text,
                "is_internal": is_internal,
                "reactions": [],
                "timestamp": timestamp,
                "thread_id": thread_id,
                "message_type": message_type,
                "event_type": "MESSAGE"  # Ensure event_type is explicitly set here
            }
            conversation_history.append(assistant_message)

            # Notify connected WebSocket clients
            await send_message_to_clients(assistant_message)

        # Handle file upload event
        elif event_type == "FILE_UPLOAD" and files_content:
            file_message = {
                "id": message_counter,
                "role": "user",
                "files_content": files_content,
                "timestamp": timestamp,
                "thread_id": thread_id,
                "is_internal": is_internal,
                "user_name": message_data.get("user_name", "User"),
                "event_type": "FILE_UPLOAD",  # Ensure event_type is explicitly set here
            }
            conversation_history.append(file_message)

            # Notify WebSocket clients about the file upload
            await send_message_to_clients(file_message)

        # Handle reaction events
        elif event_type in ["REACTION_ADD", "REACTION_REMOVE"]:
            target_message_timestamp = message_data.get("timestamp")
            target_thread_id = message_data.get("thread_id")

            if not target_message_timestamp or not target_thread_id:
                logger.warning("No timestamp or thread_id provided for the reaction event.")
                return {"status": "ERROR", "message": "No timestamp or thread_id provided."}

            # Find the target message by both timestamp and thread_id
            target_message = next(
                (msg for msg in conversation_history
                 if msg["timestamp"] == target_message_timestamp and
                    msg["thread_id"] == target_thread_id and
                    msg["role"] == "user"),
                None
            )

            if target_message:
                if event_type == "REACTION_ADD":
                    if reaction_name not in target_message["reactions"]:
                        target_message["reactions"].append(reaction_name)
                elif event_type == "REACTION_REMOVE":
                    if reaction_name in target_message["reactions"]:
                        target_message["reactions"].remove(reaction_name)

                # Broadcast the reaction update to connected clients
                update_payload = {
                    "update": event_type.lower(),
                    "timestamp": target_message_timestamp,
                    "thread_id": target_thread_id,
                    "reaction_name": reaction_name,
                    "event_type": "REACTION_UPDATE"  # Ensure event_type is explicitly set for reaction updates
                }
                await send_message_to_clients(update_payload)
            else:
                logger.warning(f"Message with timestamp {target_message_timestamp} and thread_id {target_thread_id} not found for reaction event.")

        # Trigger error for unknown event types
        else:
            logger.error(f"Unknown event_type: {event_type}")
            return {"status": "ERROR", "message": f"Unknown event_type: {event_type}"}

        return {"status": "OK"}
    except Exception as e:
        logger.error(f"Error in receive_message endpoint: {str(e)}")
        return {"status": "ERROR", "message": str(e)}


@app.post("/api/add_reaction")
async def add_reaction(request: Request):
    global conversation_history
    try:
        data = await request.json()
        message_id = data.get("message_id")
        reaction = data.get("reaction")

        if message_id is None or reaction is None:
            raise HTTPException(status_code=400, detail="message_id and reaction are required.")

        # Find the message with the given ID
        message = next((msg for msg in conversation_history if msg["id"] == message_id), None)
        if message:
            # Add the reaction to the message if not already present
            if reaction not in message["reactions"]:
                message["reactions"].append(reaction)
                update_payload = {
                    "update": "reaction",
                    "message_id": message_id,
                    "reactions": message["reactions"],
                }
                await send_message_to_clients(update_payload)
            return {"status": "Reaction added"}
        else:
            raise HTTPException(status_code=404, detail="Message not found.")

    except Exception as e:
        logger.error(f"Error in add_reaction endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    connected_clients.append(websocket)
    try:
        while True:
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        connected_clients.remove(websocket)
        print(f"Client disconnected")
    except Exception as e:
        print(f"WebSocket error: {e}")
    finally:
        if websocket in connected_clients:
            connected_clients.remove(websocket)

def get_safe_prompt_path(directory: str, filename: str) -> Path:
    # Ensure only the base name is used to prevent directory traversal
    safe_filename = Path(filename).name
    return Path(directory) / safe_filename

def ensure_txt_extension(filename: str) -> str:
    if not filename.endswith('.txt'):
        filename += '.txt'
    return filename

# Route to get the prompt content
@app.get('/api/prompt')
async def get_prompt(prompt_type: str = Query(...), prompt_name: Optional[str] = None):
    if prompt_type == 'core':
        prompt_path = get_safe_prompt_path(MAIN_PROMPTS_DIRECTORY, 'core_prompt.txt')
    elif prompt_type == 'main':
        prompt_path = get_safe_prompt_path(MAIN_PROMPTS_DIRECTORY, 'main_prompt.txt')
    elif prompt_type == 'subprompt' and prompt_name:
        prompt_name = ensure_txt_extension(prompt_name)
        prompt_path = get_safe_prompt_path(SUBPROMPTS_DIRECTORY, prompt_name)
    else:
        raise HTTPException(status_code=400, detail='Invalid prompt type or missing prompt name')
    try:
        with open(prompt_path, 'r', encoding='utf-8') as prompt_file:
            prompt_content = prompt_file.read()
        return {'prompt': prompt_content}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail='Prompt not found')
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
@app.post('/api/save-prompt')
async def save_prompt(data: PromptData):
    if data.prompt_type == 'core':
        prompt_path = get_safe_prompt_path(MAIN_PROMPTS_DIRECTORY, 'core_prompt.txt')
    elif data.prompt_type == 'main':
        prompt_path = get_safe_prompt_path(MAIN_PROMPTS_DIRECTORY, 'main_prompt.txt')
    elif data.prompt_type == 'subprompt' and data.prompt_name:
        data.prompt_name = ensure_txt_extension(data.prompt_name)
        prompt_path = get_safe_prompt_path(SUBPROMPTS_DIRECTORY, data.prompt_name)
    else:
        raise HTTPException(status_code=400, detail='Invalid prompt type or missing prompt name')
    try:
        with open(prompt_path, 'w', encoding='utf-8') as prompt_file:
            prompt_file.write(data.prompt_content)
        return {'status': 'Prompt saved successfully'}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
@app.get('/api/subprompts')
async def list_subprompts():
    try:
        prompt_files = glob.glob(str(Path(SUBPROMPTS_DIRECTORY) / '*.txt'))
        prompt_names = [Path(f).name for f in prompt_files]
        return {'prompts': prompt_names}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
@app.post('/api/create-subprompt')
async def create_subprompt(prompt_name: str = Query(...)):
    prompt_name = ensure_txt_extension(prompt_name)
    prompt_path = get_safe_prompt_path(SUBPROMPTS_DIRECTORY, prompt_name)
    try:
        if prompt_path.exists():
            raise HTTPException(status_code=400, detail='Subprompt already exists')
        with open(prompt_path, 'w', encoding='utf-8') as prompt_file:
            prompt_file.write('')
        return {'status': 'Subprompt created successfully'}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete('/api/delete-subprompt')
async def delete_subprompt(prompt_name: str = Query(...)):
    prompt_name = ensure_txt_extension(prompt_name)
    prompt_path = get_safe_prompt_path(SUBPROMPTS_DIRECTORY, prompt_name)
    try:
        if not prompt_path.exists():
            raise HTTPException(status_code=404, detail='Subprompt not found')
        prompt_path.unlink()
        return {'status': 'Subprompt deleted successfully'}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    


if __name__ == "__main__":
    uvicorn.run("main:app", host=BACKEND_HOST, port=BACKEND_PORT, reload=True)