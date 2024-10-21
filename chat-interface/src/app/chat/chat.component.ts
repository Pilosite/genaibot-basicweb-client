import { Component, OnInit, NgZone, ChangeDetectorRef, HostListener, ElementRef, ViewChild, AfterViewInit } from '@angular/core';   
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
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTabChangeEvent } from '@angular/material/tabs';
import { MatTabsModule } from '@angular/material/tabs';
import { MatSelect, MatSelectModule, MatOption } from '@angular/material/select';

import hljs from 'highlight.js';  
import { EmojiService } from '../services/emoji.service';
import { format, formatDistanceToNow, isToday, isYesterday } from 'date-fns';

import { Subject } from 'rxjs';  
import { filter, share } from 'rxjs/operators';  

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
    MatTabsModule,
    MatToolbarModule,    
    MatIconModule,    
    MatButtonModule,
    MatFormFieldModule,    
    MatInputModule,
    MatSelect,
    MatOption,
    MatProgressSpinnerModule
  ],    
})

export class ChatComponent implements OnInit, AfterViewInit {    
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

  selectedTabIndex: number = 0;
  promptContent: string = '';
  loadingPrompt: boolean = false;

  showDesignerPanel: boolean = false; // State to show/hide the designer panel
  designerWidth: number = window.innerWidth / 2; 
  designerMinWidth: number = 200; // Largeur minimale du panneau du concepteur  
  
  chatMinWidth: number = 300; // Largeur minimale du chat  
  splitterWidth: number = 5; // Largeur du splitter    
  designerMaxWidth: number = window.innerWidth - this.chatMinWidth - this.splitterWidth;  
  isSplitterDragging: boolean = false; // Indique si l'utilisateur est en train de faire glisser le splitter  
  // Subprompts management
  availableSubprompts: string[] = [];
  selectedSubprompt: string = '';
  
  shouldScrollToBottom: boolean = false;

  private isNearBottom = true;
  @ViewChild('messageList') private messageListContainer!: ElementRef;

  constructor(
    private http: HttpClient,
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone,
    private emojiService: EmojiService,
    
  ) {
    this.showInternalMessages = true;
  }
  
  
  ngAfterViewChecked() {    
    const codeBlocks = document.querySelectorAll('pre code');    
    codeBlocks.forEach((block) => {    
      hljs.highlightBlock(block as HTMLElement);  // Appliquer highlight.js aux blocs de code    
    });    
    
    if (this.shouldScrollToBottom) {  
      setTimeout(() => {  
        this.scrollToBottom();    
        this.shouldScrollToBottom = false;  // Réinitialiser le drapeau  
      }, 0); // Retard minimal  
    }  
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
    this.loadAvailableSubprompts();
  }

  ngAfterViewInit(): void {  
    // Initialiser l'état initial de isNearBottom  
    this.onScroll();  
  }  

  onTabChange(event: MatTabChangeEvent): void {
    this.selectedTabIndex = event.index;
    if (event.index === 0) {
      // Core Prompt
      this.loadPrompt('core', null);
    } else if (event.index === 1) {
      // Main Prompt
      this.loadPrompt('main', null);
    } else if (event.index === 2) {
      // Subprompts
      if (this.selectedSubprompt) {
        this.loadPrompt('subprompt', this.selectedSubprompt);
      }
    }
  }

  ngOnDestroy(): void {  
    // Votre code existant...  
    
    // Libérer les écouteurs d'événements si nécessaire  
    if (this.isSplitterDragging) {  
      document.removeEventListener('mousemove', this.onSplitterMouseMove.bind(this));  
      document.removeEventListener('mouseup', this.onSplitterMouseUp.bind(this));  
    }  
    
    // Libérer les URL de blob des fichiers  
    this.messages.forEach((message) => {  
      if (message.file?.blobUrl) {  
        URL.revokeObjectURL(message.file.blobUrl);  
      }  
    });  
  }

  @HostListener('window:resize', ['$event'])  
  onWindowResize(event: Event) {  
    if (this.showDesignerPanel) {  
      this.designerWidth = window.innerWidth / 2;  
    }  
    // Mettre à jour designerMaxWidth en fonction de la nouvelle largeur de la fenêtre  
    this.designerMaxWidth = window.innerWidth - this.chatMinWidth - this.splitterWidth;  
  }  

  // Toggle the designer panel
  toggleDesignerPanel(): void {
    this.showDesignerPanel = !this.showDesignerPanel;
  
    if (this.showDesignerPanel) {
      // Load the prompt corresponding to the selected tab
      if (this.selectedTabIndex === 0) {
        // Core Prompt
        this.loadPrompt('core', null);
      } else if (this.selectedTabIndex === 1) {
        // Main Prompt
        this.loadPrompt('main', null);
      } else if (this.selectedTabIndex === 2) {
        // Subprompt
        if (this.selectedSubprompt) {
          this.loadPrompt('subprompt', this.selectedSubprompt);
        } else {
          // Handle the case where no subprompt is selected
          this.promptContent = '';
        }
      }
    }
  }

  onSplitterMouseDown(event: MouseEvent): void {  
    this.isSplitterDragging = true;  
    document.addEventListener('mousemove', this.onSplitterMouseMove.bind(this));  
    document.addEventListener('mouseup', this.onSplitterMouseUp.bind(this));  
  }  
  
  onSplitterMouseMove(event: MouseEvent): void {  
    if (!this.isSplitterDragging) {  
      return;  
    }  
    
    const containerOffsetLeft = (document.querySelector('.main-container') as HTMLElement).getBoundingClientRect().left;  
    const newWidth = event.clientX - containerOffsetLeft;  
    
    if (newWidth >= this.designerMinWidth && newWidth <= this.designerMaxWidth) {  
      this.designerWidth = newWidth;  
    }  
  }  
  
  onSplitterMouseUp(event: MouseEvent): void {  
    this.isSplitterDragging = false;  
    document.removeEventListener('mousemove', this.onSplitterMouseMove.bind(this));  
    document.removeEventListener('mouseup', this.onSplitterMouseUp.bind(this));  
  }  
  
  // Load the prompt from the backend or a file
  loadPrompt(promptType: string, promptName: string | null): void {
    this.loadingPrompt = true;
  
    // Construct params object
    const params: { [param: string]: string } = {
      prompt_type: promptType,
      // Include prompt_name only if it's not null
      ...(promptName !== null && { prompt_name: promptName }),
    };
  
    this.http.get<{ prompt: string }>(`${environment.apiUrl}/api/prompt`, { params }).subscribe({
      next: (response) => {
        this.promptContent = response.prompt;
        this.loadingPrompt = false;
      },
      error: (error) => {
        console.error('Error loading prompt:', error);
        this.loadingPrompt = false;
      },
    });
  }
  
  onScroll(): void {    
    const threshold = 150; // Distance en pixels pour considérer que l'utilisateur est en bas    
    const position = this.messageListContainer.nativeElement.scrollTop + this.messageListContainer.nativeElement.offsetHeight;    
    const height = this.messageListContainer.nativeElement.scrollHeight;    
    this.isNearBottom = position > height - threshold;
  }  

  // Save the updated prompt back to the backend or file
  savePrompt(): void {
    this.loadingPrompt = true;
    const promptType = this.selectedTabIndex === 0 ? 'core' : this.selectedTabIndex === 1 ? 'main' : 'subprompt';
    const promptName = this.selectedTabIndex === 2 ? this.selectedSubprompt : null;

    const payload = {
      prompt_type: promptType,
      prompt_name: promptName,
      prompt_content: this.promptContent,
    };

    this.http.post(`${environment.apiUrl}/api/save-prompt`, payload).subscribe({
      next: (response: any) => {
        console.log('Prompt saved successfully:', response);
        this.loadingPrompt = false;
      },
      error: (error) => {
        console.error('Error saving prompt:', error);
        this.loadingPrompt = false;
      },
    });
  }

  loadAvailableSubprompts(): void {
    this.http.get<{ prompts: string[] }>(`${environment.apiUrl}/api/subprompts`).subscribe({
      next: (response) => {
        this.availableSubprompts = response.prompts;
        if (this.availableSubprompts.length > 0) {
          this.selectedSubprompt = this.availableSubprompts[0];
          if (this.selectedTabIndex === 2) {
            this.loadPrompt('subprompt', this.selectedSubprompt);
          }
        }
      },
      error: (error) => {
        console.error('Error loading subprompts:', error);
      },
    });
  }
  
  onSubpromptSelectionChange(promptName: string): void {
    this.selectedSubprompt = promptName;
    this.loadPrompt('subprompt', promptName);
  }

  createSubprompt(): void {
    const newPromptName = prompt('Enter a name for the new subprompt:');
    if (newPromptName) {
      this.http
        .post(`${environment.apiUrl}/api/create-subprompt`, null, { params: { prompt_name: newPromptName } })
        .subscribe({
          next: (response: any) => {
            console.log('Subprompt created successfully:', response);
            this.loadAvailableSubprompts();
          },
          error: (error) => {
            console.error('Error creating subprompt:', error);
          },
        });
    }
  }

  deleteSubprompt(): void {
    if (confirm(`Are you sure you want to delete the subprompt "${this.selectedSubprompt}"?`)) {
      this.http
        .delete(`${environment.apiUrl}/api/delete-subprompt`, { params: { prompt_name: this.selectedSubprompt } })
        .subscribe({
          next: (response: any) => {
            console.log('Subprompt deleted successfully:', response);
            this.selectedSubprompt = '';
            this.promptContent = '';
            this.loadAvailableSubprompts();
          },
          error: (error) => {
            console.error('Error deleting subprompt:', error);
          },
        });
    }
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
    this.processMessage(wsMessage);  
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
    // Vérifier si le traitement des messages est arrêté  
    if (this.stopProcessingMessages) {  
      console.log('Message processing is stopped. Ignoring incoming message.');  
      return;  
    }  
    
    console.log('Processing WebSocket message:', wsMessage);  
    console.log(`Event Type: ${wsMessage.event_type}`);  
    
    // Gérer les mises à jour des réactions  
    if (wsMessage.event_type === 'REACTION_UPDATE' && (wsMessage.update === 'reaction_add' || wsMessage.update === 'reaction_remove')) {  
      console.log('Processing reaction update:', wsMessage);  
      const reactionName = wsMessage.reaction_name || '';  // Utiliser le nom de la réaction du wsMessage  
    
      // Si la réaction est "done", mettre à jour l'état  
      if (reactionName === 'done' && wsMessage.update === 'reaction_add') {  
        this.isWaitingForResponse = false;  // Réaction "done" reçue  
        this.userStoppedWaiting = false;    // Réinitialiser le drapeau  
      }  
    
      // Trouver le message auquel la réaction s'applique  
      const message = this.messages.find(msg => {  
        const msgTimestamp = String(msg.timestamp).trim();  
        const wsTimestamp = String(wsMessage.timestamp).trim();  
        const msgThreadId = String(msg.thread_id).trim();  
        const wsThreadId = String(wsMessage.thread_id).trim();  
        // Trouver le message correspondant en utilisant le timestamp et le thread_id  
        return msgTimestamp === wsTimestamp && msgThreadId === wsThreadId;  
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
      // Ne pas appeler scrollToBottom() ici pour éviter de perturber le défilement de l'utilisateur  
      return;  // Sortir de la fonction après avoir traité les réactions  
    }  
    
    // Gérer les uploads de fichiers      
    else if (wsMessage.event_type === 'FILE_UPLOAD' && wsMessage.files_content?.length) {      
      console.log('Processing FILE_UPLOAD message:', wsMessage);  
    
      // Parcourir les fichiers reçus  
      wsMessage.files_content.forEach((fileContent) => {  
        const file: FileAttachment = {  
          filename: fileContent.filename,  
          title: fileContent.title || fileContent.filename,  
          content: fileContent.file_content,  
          isExpanded: false,  
          blobUrl: ''  
        };  
    
        // Créer un message avec le fichier  
        const message: Message = {  
          timestamp: String(wsMessage.timestamp!).trim(),  
          thread_id: String(wsMessage.thread_id!).trim(),  
          role: wsMessage.role?.toLowerCase() || 'assistant', // ou 'user' selon le cas  
          content: '', // Pas de contenu textuel, juste le fichier  
          is_internal: wsMessage.is_internal || false,  
          reactions: [],  
          username: wsMessage.user_name || 'User',  
          file: file  
        };  
    
        this.messages.push(message);  
      });  
    
      // Définir shouldScrollToBottom sur true pour défiler vers le bas  
      this.shouldScrollToBottom = true;  
    
      return;  // Sortir de la fonction après avoir traité le fichier    
    }      
    
    // Gérer les messages normaux      
    else if (wsMessage.event_type === 'MESSAGE' || wsMessage.event_type === 'MESSAGE_UPDATE') {      
      console.log(`==> Processing normal message: ${wsMessage.event_type}`);      
          
      const role = wsMessage.role?.toLowerCase() || 'assistant';      
      const username = role === 'user' ? 'User' : 'Remote Bot'; // Définir des noms personnalisés      
          
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
    
      // Définir shouldScrollToBottom sur true pour défiler vers le bas  
      this.shouldScrollToBottom = true;    
    
      return;  // Sortir de la fonction après avoir traité le message    
    }      
    
    // Gérer d'autres types d'événements si nécessaire    
    else {    
      // Traitez les autres types d'événements ici    
      console.warn(`Unhandled event type: ${wsMessage.event_type}`);    
    }    
  }  
  
  processPendingReactions(message: Message): void {  
    this.pendingReactions.forEach((wsMessage) => {  
      const reactionName = wsMessage.reaction_name || '';  
      if (reactionName) {  
        const emoji = this.getEmojiByName(reactionName) || reactionName;  
        if (wsMessage.update === 'reaction_add') {  
          if (!message.reactions.includes(emoji)) {  
            message.reactions.push(emoji);  
          }  
          console.log('Applied pending reaction:', emoji);  
        } else if (wsMessage.update === 'reaction_remove') {  
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
      this.messageListContainer.nativeElement.scrollTop = this.messageListContainer.nativeElement.scrollHeight;  
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

