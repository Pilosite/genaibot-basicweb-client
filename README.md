# genaibot-basicweb-client
basic web client for younited genaibot framework

Create a .env with the following information, only change the LLM_NOTIFICATION_ENDPOINT to your younited genaibot framework actual endpoint.
```yaml
CLIENT_ID="BotTester"
GENAIBOT_ID = "Remote Bot"
LLM_NOTIFICATION_ENDPOINT="http://localhost:7071/api/get_generic_rest_notification"  
TIMEOUT=30  
MAX_ITERATIONS=10  
DEBUG_MODE=False  
  
BACKEND_HOST=0.0.0.0  
BACKEND_PORT=8000  
ALLOWED_ORIGINS=http://localhost:4200  
```
Launch this client using vscode debugger, select "Launch Full Stack"
![image](https://github.com/user-attachments/assets/efce2053-f5a0-41d3-afef-b3f10fdbb960)

### Configuration of Younited Genaibot Framework

You need to configure the `config.yaml` file of the Younited Genaibot framework to enable communication with the Assistant CLI application.

1. **Locate the `config.yaml` File**

   The `config.yaml` file is typically located in the root directory of the Younited Genaibot framework repository.

2. **Edit the `config.yaml` File**

   Add or update the following section in the `config.yaml`:

   ```yaml
   USER_INTERACTIONS:
     CUSTOM_API:
       # {}
       GENERIC_REST:
         PLUGIN_NAME: "generic_rest"
         GENERIC_REST_ROUTE_PATH: "/api/get_generic_rest_notification"
         GENERIC_REST_ROUTE_METHODS: ["POST"]
         GENERIC_REST_BEHAVIOR_PLUGIN_NAME: "im_default_behavior"
         GENERIC_REST_MESSAGE_URL: "http://localhost:8000/api/receive_message"
         GENERIC_REST_REACTION_URL: "http://localhost:8000/api/receive_message"
         GENERIC_REST_BOT_ID: "GenaiBotDebugger"
   ```

   **Explanation of the Configuration**:

   - **PLUGIN_NAME**: Specifies the plugin used for the generic REST interaction.
   - **GENERIC_REST_ROUTE_PATH**: The API route path for receiving notifications.
   - **GENERIC_REST_ROUTE_METHODS**: The HTTP methods allowed for the route.
   - **GENERIC_REST_BEHAVIOR_PLUGIN_NAME**: The behavior plugin to use.
   - **GENERIC_REST_MESSAGE_URL**: The URL where the bot receives messages from the assistant.
   - **GENERIC_REST_REACTION_URL**: The URL where the bot sends reactions to the assistant.
   - **GENERIC_REST_BOT_ID**: An identifier for the bot.

3. **Ensure Endpoints Match**

   - The `GENERIC_REST_MESSAGE_URL` and `GENERIC_REST_REACTION_URL` should match the `LLM_NOTIFICATION_ENDPOINT` specified in your `.env` file for the Assistant CLI application (e.g., `http://localhost:8000/api/receive_message`).

### Running the Younited Genaibot Framework

Before starting the Assistant CLI application, you need to run the Younited Genaibot backend.

Ensure that the framework is running and listening on the appropriate ports as configured.
