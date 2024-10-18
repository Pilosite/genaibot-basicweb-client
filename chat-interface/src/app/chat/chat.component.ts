import { Component, OnInit, NgZone, ChangeDetectorRef } from '@angular/core';    
import { FormsModule } from '@angular/forms';    
import { CommonModule } from '@angular/common';    
import { MarkdownModule } from 'ngx-markdown';    
import { HttpClient } from '@angular/common/http';    
import { WebSocketSubject } from 'rxjs/webSocket';    
import { environment } from '../../environment/environment';    

// Import des modules Angular Material    
import { MatToolbarModule } from '@angular/material/toolbar';    
import { MatIconModule } from '@angular/material/icon';    
import { MatButtonModule } from '@angular/material/button';    
import { MatFormFieldModule } from '@angular/material/form-field';    
import { MatInputModule } from '@angular/material/input';    
import hljs from 'highlight.js';  
import { EmojiService } from '../services/emoji.service';
import { format, formatDistanceToNow, isToday, isYesterday } from 'date-fns';

// Définition de l'interface WSMessage    
interface WSMessage {
  id?: number;
  role?: string;
  content?: string;
  text?: string;
  is_internal?: boolean;
  reactions?: string[];
  update?: string;
  reaction_name?: string;
  user_name?: string;
  timestamp?: string;
  thread_id?: string;
  files_content?: { file_content: string, filename: string, title: string }[]; // Add files_content for file upload
  event_type?: string; // Add event_type to distinguish message types
}

interface Message {
  timestamp: string;
  thread_id: string;
  role: string;
  content: string;
  is_internal: boolean;
  reactions: string[];
  username: string;
  file?: FileAttachment;  // Optional file property
}

interface FileAttachment {
  filename: string;
  title: string;
  content: string;  // Assuming the content is a string or base64
  isExpanded?: boolean;  // For expanding or collapsing the preview
  blobUrl?: string;  // For storing the generated blob URL
}

@Component({    
  selector: 'app-chat',    
  templateUrl: './chat.component.html',    
  styleUrls: ['./chat.component.css'],    
  standalone: true,    
  imports: [    
    CommonModule,    
    FormsModule,    
    MarkdownModule, // Import sans forRoot()    
    // Modules Angular Material    
    MatToolbarModule,    
    MatIconModule,    
    MatButtonModule,    
    MatFormFieldModule,    
    MatInputModule,    
  ],    
})

export class ChatComponent implements OnInit {    
  messages: Message[] = [];    
  userInput: string = '';    
  showInternalMessages: boolean = false;
  private socket$!: WebSocketSubject<any>;    
  threadId: string = ''; 
  private clientId: string = environment.clientId;    
  pendingReactions: WSMessage[] = []; 
  messageQueue: WSMessage[] = [];  
  isProcessingQueue: boolean = false;  
  lastUserMessageTimestamp: string = '';
  isWaitingForResponse: boolean = false;  
  userStoppedWaiting: boolean = false;  
  latestUserTimestamp: string = ''; 
  stopProcessingMessages: boolean = false;
  
  constructor(
    private http: HttpClient,
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone,
    private emojiService: EmojiService // Ajoutez le service ici
  ) {}
  
  
  ngAfterViewChecked() {
    const codeBlocks = document.querySelectorAll('pre code');
    codeBlocks.forEach((block) => {
      hljs.highlightBlock(block as HTMLElement);  // Apply highlight.js to code blocks
    });
    this.scrollToBottom();
  }
  
  ngOnInit(): void {    
    // Générer un threadId au démarrage  
    this.threadId = this.generateThreadId();  
    console.log(`Generated thread ID: ${this.threadId}`);  

    this.socket$ = new WebSocketSubject(`${environment.apiUrl.replace('http', 'ws')}/ws`);    
    this.socket$.subscribe({    
      next: (wsMessage: WSMessage) => this.handleSocketMessage(wsMessage),    
      error: (err) => console.error('WebSocket error:', err),    
      complete: () => console.warn('WebSocket connection closed'),    
    });    
  }    

  ngOnDestroy(): void {
    this.messages.forEach((message) => {
      if (message.file?.blobUrl) {
        URL.revokeObjectURL(message.file.blobUrl);
      }
    });
  }
  
  generateThreadId(): string {  
    const currentTimestamp = Date.now() / 1000; // Obtenir le timestamp en secondes  
    const threadId = currentTimestamp.toFixed(4); // Formater avec 4 chiffres après la virgule  
    return threadId;  
  }  

  highlightFileContent(content: string): string {
    // Return the syntax-highlighted content
    return hljs.highlightAuto(content).value;
  }

  handleSocketMessage(wsMessage: WSMessage): void {  
    if (this.stopProcessingMessages) {
      console.log('Message processing stopped. Ignoring incoming message.');
      return;
    }
    this.messageQueue.push(wsMessage);  
    this.processQueue();  
  }  

  formatTimestamp(timestamp: string): string {
    const date = new Date(parseFloat(timestamp) * 1000); // Convert Unix timestamp to milliseconds
  
    if (isToday(date)) {
      return format(date, 'HH:mm'); // Only show the time if it's today
    } else if (isYesterday(date)) {
      return `Yesterday, ${format(date, 'HH:mm')}`; // Show "Yesterday" and the time
    } else {
      return format(date, 'dd MMM, HH:mm'); // Show the date and time if it's older
    }
  }

  processQueue(): void {  
    if (this.isProcessingQueue || this.messageQueue.length === 0) {  
      return;  
    }  
    this.isProcessingQueue = true;  

    const wsMessage = this.messageQueue.shift()!;  
    this.processMessage(wsMessage);  

    this.isProcessingQueue = false;  
    if (this.messageQueue.length > 0) {  
      this.processQueue();  
    }  
  }  

  isImageFile(filename: string): boolean {
    const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg'];
    const ext = filename.split('.').pop()?.toLowerCase();
    return imageExtensions.includes(ext || '');
  }

  fileToUrl(file: FileAttachment): string {
    if (!file.blobUrl) {
      const decodedContent = this.deSanitizeContent(file.content);  // Use the updated function
      const blob = new Blob([decodedContent], { type: 'text/plain' });
      file.blobUrl = URL.createObjectURL(blob);
    }
    return file.blobUrl || '';
  }
  

  deSanitizeContent(content: string): string {
    return content.replace(/\\u[\dA-Fa-f]{4}/g, (match) => {
      return String.fromCharCode(parseInt(match.replace(/\\u/g, ''), 16));
    }).replace(/\\n/g, '\n')  // Handle new lines
      .replace(/\\"/g, '"');   // Handle escaped quotes
  }
  
  // Check if the expand button should be shown
  shouldShowExpandButton(content: string): boolean {
    return content.length > 100; // Show button only for longer content
  }
  
  // Toggle expand/collapse state for file content
  toggleFileExpand(file: FileAttachment): void {
    file.isExpanded = !file.isExpanded;
  }

  sanitizeFileContent(content: string): string {
    // Decode common escape sequences (e.g., \n -> new line, \" -> quote)
    const textArea = document.createElement('textarea');
    textArea.innerHTML = content;
    return textArea.value.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\'/g, "'");
  }

  /**
   * Highlight the preview of the file content (first few lines or characters)
   */
  highlightFilePreview(fileContent: string): string {
    // Preview should be a truncated version of the file content
    const previewContent = fileContent.slice(0, 200); // First 200 characters for example
    return this.highlightText(previewContent);
  }

  /**
   * Highlight the full file content
   */
  highlightFullFileContent(fileContent: string): string {
    return this.highlightText(fileContent);
  }

  /**
   * Highlight text using highlight.js
   */
  highlightText(text: string): string {
    const highlighted = hljs.highlightAuto(text).value;
    return highlighted;
  }

  getFileMimeType(filename: string): string {
    const extension = filename.split('.').pop()?.toLowerCase();
    switch (extension) {
      case 'txt': return 'text/plain';
      case 'json': return 'application/json';
      case 'yaml': return 'text/yaml';
      case 'jpg': case 'jpeg': return 'image/jpeg';
      case 'png': return 'image/png';
      case 'gif': return 'image/gif';
      default: return 'application/octet-stream';
    }
  }

  getFilePreview(content: string): string {
    const previewLimit = 100;
    return content.length > previewLimit ? content.substring(0, previewLimit) + '...' : content;
  }

  processMessage(wsMessage: WSMessage): void {
    // Check if the stop flag is set to prevent processing
    if (this.stopProcessingMessages) {
      console.log('Message processing is stopped. Ignoring incoming message.');
      return;
    }
  
    console.log('Processing WebSocket message:', wsMessage);
    console.log(`Event Type: ${wsMessage.event_type}`);
  
    // Filter out messages that do not belong to the latest user message (based on timestamp)
    if (wsMessage.timestamp !== this.latestUserTimestamp) {
      console.log('Ignoring message from previous user input.');
      return;  // Ignore message
    }
  
    // Handle "done" reaction and re-enable the Send button
    if (wsMessage.event_type === 'REACTION_UPDATE' && wsMessage.reaction_name === 'done') {
      if (wsMessage.update === 'reaction_add') {
        this.isWaitingForResponse = false;  // Reaction "done" received
        this.userStoppedWaiting = false;    // Reset flag
      }
    }
  
    // Handle reaction updates
    if (wsMessage.update === 'reaction_add' || wsMessage.update === 'reaction_remove') {
      console.log(`Processing reaction update:`, wsMessage);
  
      const reactionName = wsMessage.reaction_name || '';  // Use the reaction from wsMessage
  
      // Find the message with timestamp, thread_id, and role 'user'
      const message = this.messages.find(msg => {
        const msgTimestamp = String(msg.timestamp).trim();
        const wsTimestamp = String(wsMessage.timestamp).trim();
        const msgThreadId = String(msg.thread_id).trim();
        const wsThreadId = String(wsMessage.thread_id).trim();
        const msgRole = String(msg.role).trim().toLowerCase();
  
        return msgTimestamp === wsTimestamp && msgThreadId === wsThreadId && msgRole === 'user';
      });
  
      if (message && reactionName) {
        const emoji = this.getEmojiByName(reactionName) || reactionName;
  
        if (wsMessage.update === 'reaction_add') {
          if (!message.reactions.includes(emoji)) {
            message.reactions.push(emoji);
          }
        } else if (wsMessage.update === 'reaction_remove') {
          const index = message.reactions.indexOf(emoji);
          if (index !== -1) {
            message.reactions.splice(index, 1);
          }
        }
      } else {
        console.warn('Message not found for reaction update.');
        this.pendingReactions.push(wsMessage);
      }
    }
  
    // Handle file uploads
    else if (wsMessage.event_type === 'FILE_UPLOAD' && wsMessage.files_content?.length) {
      console.log(`==> Processing FILE_UPLOAD event: ${wsMessage.files_content.length} files uploaded.`);
      console.log('File upload message received. Role:', wsMessage.role, 'Username:', wsMessage.user_name);
      wsMessage.files_content.forEach(file => {
        console.log('==> File details:', file);
  
        const role = wsMessage.role?.toLowerCase() || 'assistant';
        const username = role === 'user' ? 'User' : 'Remote Bot'; // Set custom names for file upload
  
        const fileMessage: Message = {
          timestamp: String(wsMessage.timestamp!).trim(),
          thread_id: String(wsMessage.thread_id!).trim(),
          role,
          content: '',  // No text content, just the file
          is_internal: wsMessage.is_internal || false,
          reactions: [],
          username
        };
  
        // Add the file to the message as an object
        fileMessage['file'] = {
          filename: file.filename,
          title: file.title,
          content: file.file_content  // Assuming this is base64 encoded or a string
        };
  
        console.log('==> Created file message:', fileMessage);
        this.messages.push(fileMessage);
      });
  
      this.scrollToBottom();  // Automatically scroll to the latest message
    }
  
    // Handle normal messages
    else {
      console.log(`==> Processing normal message: ${wsMessage.event_type}`);
  
      const role = wsMessage.role?.toLowerCase() || 'assistant';
      const username = role === 'user' ? 'User' : 'Remote Bot'; // Set custom names
  
      const message: Message = {
        timestamp: String(wsMessage.timestamp!).trim(),
        thread_id: String(wsMessage.thread_id!).trim(),
        role,
        content: this.emojiService.convert(this.parseEmojis(this.processMentions(wsMessage.content || wsMessage.text || ''))),
        is_internal: wsMessage.is_internal || false,
        reactions: [],
        username
      };
  
      console.log('Added message:', message);
      this.messages.push(message);
  
      if (message.role === 'user' && !message.is_internal) {
        this.lastUserMessageTimestamp = message.timestamp;
        this.processPendingReactions(message);
      }
  
      this.scrollToBottom();
    }
  }
  
  
  processPendingReactions(message: Message): void {  
    this.pendingReactions.forEach((wsMessage) => {  
      const reactions = wsMessage.reactions || [];  
      const reactionName = reactions.length > 0 ? reactions[reactions.length -1] : null;  

      if (reactionName) {  
        if (wsMessage.update === 'reaction_add') {  
          const emoji = this.getEmojiByName(reactionName) || reactionName;  
          if (!message.reactions.includes(emoji)) {  
            message.reactions.push(emoji);  
          }  
          console.log('Applied pending reaction:', emoji);  
        } else if (wsMessage.update === 'reaction_remove') {  
          const emoji = this.getEmojiByName(reactionName) || reactionName;  
          const index = message.reactions.indexOf(emoji);  
          if (index !== -1) {  
            message.reactions.splice(index, 1);  
          }  
          console.log('Removed pending reaction:', emoji);  
        }  
      }  
    });  
    this.pendingReactions = [];  
  }  

  processMentions(text: string): string {
    // Utilise une expression régulière pour trouver les mentions commençant par @
    return text.replace(/(@\w+)/g, (match) => {
      return `<span class="mention">${match}</span>`;
    });
  }

  scrollToBottom(): void {
    try {
      const messageList = document.querySelector('.message-list');
      if (messageList) {
        messageList.scrollTop = messageList.scrollHeight;
      }
    } catch (err) {
      console.error('Error scrolling to bottom:', err);
    }
  }
  
  sendMessage(): void {  
    // Prevent sending if input is empty
    if (this.userInput.trim() === '') return;  
    
    // Get current timestamp and convert to seconds with milliseconds
    const currentTimestamp = Date.now() / 1000;  
    const timestampWithMillis = currentTimestamp.toFixed(4);  
    
    // Store the latest user message timestamp to track responses
    this.latestUserTimestamp = timestampWithMillis;
    
    // Reset the flag to allow new message responses to be processed
    this.stopProcessingMessages = false;
    
    // Construct the message payload
    const messagePayload = {  
      "channel_id": 1,  
      "event_type": "MESSAGE",  
      "response_id": 1,  
      "text": this.userInput,  
      "thread_id": this.threadId,  
      "timestamp": timestampWithMillis,  
      "user_email": `${this.clientId}@example.com`,  
      "user_id": 1,  
      "user_name": 'User',
      "reaction_name": null,  
      "files_content": [],  
      "images": [],  
      "is_mention": true,  
      "origin_plugin_name": this.clientId,  
      "message_type": "TEXT",  
      "is_internal": false,  
      "raw_data": { "text": this.userInput },  
      "username": this.clientId,  
      "event_label": "message",  
      "api_app_id": "genaibot",  
      "app_id": "genaibot",
      "role": "user"
    };  
    
    console.log('Sending message:', messagePayload);  
    
    // Send the message to the backend using HTTP
    this.http.post('/api/send_message', messagePayload).subscribe(  
      (response: any) => {  
        // Set waiting state after message is sent
        this.isWaitingForResponse = true;  // Make sure we set this to true
        this.userStoppedWaiting = false;  // Reset this in case the user had stopped
        console.log('Message sent successfully', response);
    
        // Update the UI button state after sending
        this.updateSendButtonState();
      },  
      (error) => {  
        console.error('Error sending message:', error);  
      }  
    );  
    
    // Clear the input field after the message is sent
    this.userInput = '';  
    // Update the button state to reflect cleared input
    this.updateSendButtonState();  
  }
 
  
  stopWaiting(): void {
    this.userStoppedWaiting = true;
    this.isWaitingForResponse = false;  // Allow sending new messages after pressing Stop
  
    // Set the flag to stop processing any future messages
    this.stopProcessingMessages = true;
  
    // Clear any pending responses linked to the previous message
    this.clearPendingResponses();
  }
  
  // Clear any pending responses that were queued up before "Stop" was pressed
  clearPendingResponses(): void {
    this.messageQueue = [];  // Clear the message queue
    console.log('Pending responses cleared.');
  }

  resetConversation(): void {
    // Clear the message list
    this.messages = [];
    this.threadId = this.generateThreadId();
    console.log(`Conversation reset. New thread ID: ${this.threadId}`);
    
    // Add system message indicating the reset
    const systemMessage: Message = {
      timestamp: Date.now().toString(),
      role: 'system',
      content: `Conversation has been reset. New thread ID: ${this.threadId}`,
      is_internal: false,
      reactions: [],
      username: 'System',
      thread_id: this.threadId
    };
    this.messages.push(systemMessage);

    // Reset the Send/Stop button to 'Send' and enable it
    const sendButton = document.getElementById('sendButton') as HTMLButtonElement;
    if (sendButton) {
      sendButton.textContent = 'Send';  // Set button text to 'Send'
      sendButton.disabled = false;  // Enable the button after resetting
    }

    // Reset the waiting state
    this.isWaitingForResponse = false;
    this.userStoppedWaiting = false;

    // Clear the message input field
    this.userInput = '';
  }

  updateSendButtonState(): void {
    const sendButton = document.getElementById('sendButton') as HTMLButtonElement;
    const stopButton = document.getElementById('stopButton') as HTMLButtonElement;
  
    if (sendButton) {
      sendButton.disabled = this.userInput.trim() === '';  // Disable if input is empty
    }
  
    if (stopButton) {
      stopButton.style.display = this.isWaitingForResponse ? 'inline-block' : 'none';  // Show stop if waiting
    }
  }

  parseEmojis(text: string): string {    
    return text.replace(/:([a-zA-Z0-9_+\-]+):/g, (match, p1) => {    
      const emoji = this.getEmojiByName(p1);    
      return emoji ? emoji : match;    
    });    
  }    

  getEmojiByName(name: string): string | null {      
    const emojiMap: { [key: string]: string } = {      
      processing: '⚙️',      
      done: '✅',      
      acknowledge: '👀',      
      generating: '🤔',      
      writing: '✏️',      
      error: '❌',      
      wait: '⌚',      
    };      
    return emojiMap[name.toLowerCase()] || null;      
  }    

  toggleInternalMessages(): void {
    this.showInternalMessages = !this.showInternalMessages;
  }  
}

