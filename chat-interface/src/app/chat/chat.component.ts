import { Component, OnInit, NgZone } from '@angular/core';    
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
  timestamp?: string;  // Utilisation du timestamp comme identifiant
  thread_id?: string;  // Utilisation du thread_id pour les conversations
}

interface Message {
  timestamp: string;
  thread_id: string;
  role: string;
  content: string;
  is_internal: boolean;
  reactions: string[];
  username: string;
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

  constructor(private http: HttpClient, private ngZone: NgZone) {}    

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

  generateThreadId(): string {  
    const currentTimestamp = Date.now() / 1000; // Obtenir le timestamp en secondes  
    const threadId = currentTimestamp.toFixed(4); // Formater avec 4 chiffres après la virgule  
    return threadId;  
  }  

  handleSocketMessage(wsMessage: WSMessage): void {  
    this.messageQueue.push(wsMessage);  
    this.processQueue();  
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

  processMessage(wsMessage: WSMessage): void {  
    console.log('Processing WebSocket message:', wsMessage);  
  
    if (wsMessage.update === 'reaction_add' || wsMessage.update === 'reaction_remove') {  
      console.log(`Processing reaction update:`, wsMessage);  
  
      const reactionName = wsMessage.reaction_name || '';  // Utiliser la réaction envoyée dans wsMessage
    
      // Recherche du message avec timestamp, thread_id et rôle 'user'
      const message = this.messages.find(msg => {
        const msgTimestamp = String(msg.timestamp).trim();
        const wsTimestamp = String(wsMessage.timestamp).trim();
        const msgThreadId = String(msg.thread_id).trim();
        const wsThreadId = String(wsMessage.thread_id).trim();
        const msgRole = String(msg.role).trim().toLowerCase();
  
        // Comparaison explicite avec 'user'
        const isMatch = msgTimestamp === wsTimestamp &&
                        msgThreadId === wsThreadId &&
                        msgRole === 'user';
        return isMatch;
      });  
  
      if (message && reactionName) {  
        const emoji = this.getEmojiByName(reactionName) || reactionName;  
        console.log('Reaction name:', reactionName);  
  
        if (wsMessage.update === 'reaction_add') {  
          if (!message.reactions.includes(emoji)) {  // Vérifier si la réaction n'est pas déjà présente
            message.reactions.push(emoji);  
            console.log('Added reaction:', emoji);  
          } else {
            console.log('Reaction already present, skipping add:', emoji);  // Log si la réaction est déjà présente
          }
        } else if (wsMessage.update === 'reaction_remove') {  
          const index = message.reactions.indexOf(emoji);  
          if (index !== -1) {  // Vérifier si la réaction est présente avant de la supprimer
            message.reactions.splice(index, 1);  
            console.log('Removed reaction:', emoji);  
          } else {
            console.warn('Reaction not found for removal:', emoji);  // Log si la réaction n'existe pas
          }
        }  
      } else {  
        console.warn('Message not found for reaction update.');
        console.log('Reaction name:', reactionName);  // Log pour vérifier la réaction
        console.log('Target timestamp:', wsMessage.timestamp);
        console.log('Target thread_id:', wsMessage.thread_id);
        this.pendingReactions.push(wsMessage);  // Ajouter aux réactions en attente si le message n'est pas trouvé
      }  
    } else {  
      // Ajouter un nouveau message s'il ne s'agit pas d'une mise à jour de réaction
      const message: Message = {  
        timestamp: String(wsMessage.timestamp!).trim(),  
        thread_id: String(wsMessage.thread_id!).trim(),  
        role: String(wsMessage.role || 'assistant').trim().toLowerCase(),  
        content: this.parseEmojis(this.processMentions(wsMessage.content || wsMessage.text || '')),  
        is_internal: wsMessage.is_internal || false,  
        reactions: [],  
        username: wsMessage.user_name || this.clientId,  
      };  
      this.messages.push(message);  
      console.log('Added message:', message);  
  
      // Si le message est de l'utilisateur, mettre à jour l'indice du dernier message utilisateur  
      if (message.role === 'user' && !message.is_internal) {  
        this.lastUserMessageTimestamp = message.timestamp;  
        this.processPendingReactions(message);  // Traiter les réactions en attente si nécessaire
      }
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
    return text.replace(/(@\w+)/g, (match) => {    
      return `<span class="mention">${match}</span>`;    
    });    
  }    

  sendMessage(): void {  
    if (this.userInput.trim() === '') return;  
  
    const currentTimestamp = Date.now() / 1000;  
    const timestampWithMillis = currentTimestamp.toFixed(4);  
  
    // Construire le payload pour le backend
    const messagePayload = {  
      "channel_id": 1,  
      "event_type": "MESSAGE",  
      "response_id": 1,  
      "text": this.userInput,  
      "thread_id": this.threadId,  
      "timestamp": timestampWithMillis,  
      "user_email": `${this.clientId}@example.com`,  
      "user_id": 1,  
      "user_name": this.clientId,  
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
      "role": "user"  // Assurer que le rôle est 'user'
    };  
  
    console.log('Sending message:', messagePayload);  
  
    this.http.post('/api/send_message', messagePayload).subscribe(  
      (response: any) => {  
        console.log('Message sent successfully', response);  
      },  
      (error) => {  
        console.error('Error sending message:', error);  
      }  
    );  
    this.userInput = '';  
  }
  

  resetConversation(): void {  
    this.messages = [];  
    this.threadId = this.generateThreadId();  
    console.log(`Conversation reset. New thread ID: ${this.threadId}`);  
  
    const systemMessage: Message = {  
      timestamp: Date.now().toString(),  
      role: 'system',  
      content: `Conversation has been reset. New thread ID: ${this.threadId}`,  
      is_internal: false,  
      reactions: [],  
      username: 'System',  
      thread_id: this.threadId  // Inclure le thread_id ici
    };  
  
    this.messages.push(systemMessage);  
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
