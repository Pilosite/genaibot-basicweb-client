from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request  
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
  
# Load environment variables from .env file  
load_dotenv()  
  
# Read environment variables  
CLIENT_ID = os.getenv("CLIENT_ID", "default_client")  
LLM_NOTIFICATION_ENDPOINT = os.getenv(  
    "LLM_NOTIFICATION_ENDPOINT", "http://localhost:8000/api/receive_message"  
)  
BACKEND_HOST = os.getenv("BACKEND_HOST", "0.0.0.0")  
BACKEND_PORT = int(os.getenv("BACKEND_PORT", 8000))  
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:4200").split(",")  
TIMEOUT = int(os.getenv("TIMEOUT", 30))  
MAX_ITERATIONS = int(os.getenv("MAX_ITERATIONS", 10))  
DEBUG_MODE = os.getenv("DEBUG_MODE", "False").lower() == "true"  
  
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
  
# For generating unique thread IDs  
def generate_thread_id():  
    current_timestamp = datetime.now(timezone.utc).timestamp()  
    thread_id = "{:.4f}".format(current_timestamp)  
    return thread_id  
  
thread_id = generate_thread_id()  
  
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
        thread_id = message_data.get("thread_id", generate_thread_id())  # Assurez-vous que le thread_id est bien généré

        logger.info("Received message on /api/send_message")

        # Incrémenter le compteur de messages et attribuer un ID
        message_counter += 1
        user_message = {
            "id": message_counter,
            "role": "user",  # Assurez-vous que le rôle est 'user'
            "content": text,
            "is_internal": False,
            "reactions": [],
            "user_name": message_data.get("user_name", "User"),
            "timestamp": message_data.get("timestamp", datetime.now(timezone.utc).timestamp()),  # Ajout du timestamp
            "thread_id": thread_id  # Assurez-vous d'inclure le thread_id
        }
        conversation_history.append(user_message)  # Ajouter le message à l'historique

        # Diffuser le message de l'utilisateur aux clients connectés via WebSocket
        for connection in connected_clients:
            await connection.send_json(user_message)

        # Appeler le programme externe pour traiter le message utilisateur
        await call_llm_backend(message_data)

        return {"status": "Message received", "message_id": message_counter}
    except Exception as e:
        logger.error(f"Error in send_message endpoint: {str(e)}")
        return {"status": "ERROR", "message": str(e)}
  
async def call_llm_backend(message_payload):  
    headers = {"Content-Type": "application/json"}  
    try:  
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=TIMEOUT)) as session:  
            async with session.post(LLM_NOTIFICATION_ENDPOINT, headers=headers, json=message_payload) as response:  
                if response.status in [200, 202]:  
                    logger.info("Message accepted by LLM backend.")  
                else:  
                    logger.error(f"Failed to send message to LLM backend: {response.status}")  
        # Handle the LLM's response if needed  
    except asyncio.TimeoutError:  
        logger.error("Timeout while sending message to LLM backend.")  
    except Exception as e:  
        logger.error(f"Error during LLM backend interaction: {str(e)}")  
  
@app.post("/api/receive_message")
async def receive_message(request: Request):
    global conversation_history, message_counter
    try:
        message_data = await request.json()
        event_type = message_data.get("event_type", "")
        text = message_data.get("text", "")
        reaction_name = message_data.get("reaction_name", "")
        is_internal = message_data.get("is_internal", False)

        logger.info(f"Received message on /api/receive_message: {event_type} reaction name: {reaction_name}")
        message_counter += 1

        # Assurez-vous que chaque message a son propre timestamp et thread_id
        timestamp = message_data.get("timestamp", datetime.now(timezone.utc).timestamp())
        thread_id = message_data.get("thread_id", "default_thread")

        # Gérer les messages réguliers
        if event_type == "MESSAGE":
            assistant_message = {
                "id": message_counter,
                "role": "assistant_internal" if is_internal else "assistant",
                "content": text,
                "is_internal": is_internal,
                "reactions": [],
                "timestamp": timestamp,
                "thread_id": thread_id  # Enregistrer le thread_id ici aussi
            }
            conversation_history.append(assistant_message)
            # Notifier les clients connectés
            for connection in connected_clients:
                await connection.send_json(assistant_message)

        # Gérer les événements de réactions
        elif event_type in ["REACTION_ADD", "REACTION_REMOVE"]:
            target_message_timestamp = message_data.get("timestamp")
            target_thread_id = message_data.get("thread_id")

            if not target_message_timestamp or not target_thread_id:
                logger.warning("No timestamp or thread_id provided for the reaction event.")
                return {"status": "ERROR", "message": "No timestamp or thread_id provided."}

            # Utiliser à la fois le timestamp et le thread_id pour trouver le message cible
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

                # Diffuser la mise à jour aux clients connectés
                update_payload = {
                    "update": event_type.lower(),
                    "timestamp": target_message_timestamp,
                    "thread_id": target_thread_id,
                    "reaction_name": reaction_name,
                }
                for connection in connected_clients:
                    await connection.send_json(update_payload)
            else:
                logger.warning(f"Message with timestamp {target_message_timestamp} and thread_id {target_thread_id} not found for reaction event.")

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
                # Notify connected clients about the updated message  
                update_payload = {  
                    "update": "reaction",  
                    "message_id": message_id,  
                    "reactions": message["reactions"],  
                }  
                for connection in connected_clients:  
                    await connection.send_json(update_payload)  
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
            # Handle incoming messages from the client if needed  
    except WebSocketDisconnect:  
        connected_clients.remove(websocket)  
        print(f"Client disconnected")  
    except Exception as e:  
        print(f"WebSocket error: {e}")  
    finally:  
        if websocket in connected_clients:  
            connected_clients.remove(websocket)  
  
if __name__ == "__main__":  
    uvicorn.run("main:app", host=BACKEND_HOST, port=BACKEND_PORT, reload=True)  
