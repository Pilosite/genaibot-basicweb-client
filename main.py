from fastapi import FastAPI, WebSocket  
from fastapi.responses import HTMLResponse  
from fastapi.middleware.cors import CORSMiddleware  
from pydantic import BaseModel  
from typing import List  
import aiohttp  
import os  
from dotenv import load_dotenv  
  
import uvicorn  
  
# Load environment variables from .env file  
load_dotenv()  
  
app = FastAPI()  
  
# Read environment variables  
CLIENT_ID = os.getenv("CLIENT_ID", "default_client")  
LLM_NOTIFICATION_ENDPOINT = os.getenv("LLM_NOTIFICATION_ENDPOINT", "http://localhost:8000/api/receive_message")  
BACKEND_HOST = os.getenv("BACKEND_HOST", "0.0.0.0")  
BACKEND_PORT = int(os.getenv("BACKEND_PORT", 8000))  
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:4200").split(",")  
  
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
  
class Message(BaseModel):  
    role: str  
    content: str  
    is_internal: bool = False  
    reactions: List[str] = []  
  
@app.post("/api/send_message")  
async def send_message(message: Message):  
    # Process the message and send to LLM  
    # Here you'd interact with your LLM backend  
    # For this example, we'll simulate a response  
    response_content = f"Echo: {message.content}"  
    response_message = Message(role="assistant", content=response_content)  
    conversation_history.append(response_message)  
    # Notify connected clients  
    for connection in connected_clients:  
        await connection.send_json(response_message.dict())  
    return {"status": "Message sent"}  
  
@app.post("/api/add_reaction")  
async def add_reaction(message_index: int, reaction: str):  
    # Add reaction to the specified message  
    if 0 <= message_index < len(conversation_history):  
        conversation_history[message_index].reactions.append(reaction)  
        # Notify connected clients  
        for connection in connected_clients:  
            await connection.send_json({  
                "update": "reaction",  
                "message_index": message_index,  
                "reactions": conversation_history[message_index].reactions  
            })  
        return {"status": "Reaction added"}  
    else:  
        return {"status": "Invalid message index"}  
  
@app.websocket("/ws")  
async def websocket_endpoint(websocket: WebSocket):  
    await websocket.accept()  
    connected_clients.append(websocket)  
    try:  
        while True:  
            data = await websocket.receive_text()  
            # Handle incoming messages from the client if needed  
    except Exception as e:  
        print(f"WebSocket error: {e}")  
    finally:  
        connected_clients.remove(websocket)  
  
# Add the following block  
if __name__ == "__main__":  
    uvicorn.run("main:app", host=BACKEND_HOST, port=BACKEND_PORT, reload=True)  
