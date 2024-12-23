import { Component, OnInit, NgZone, ChangeDetectorRef, HostListener, ElementRef, ViewChild, AfterViewInit } from '@angular/core';   
import { FormsModule } from '@angular/forms';    
import { CommonModule } from '@angular/common';    
import { MarkdownModule } from 'ngx-markdown';    
import { HttpClient } from '@angular/common/http';    
import { WebSocketSubject } from 'rxjs/webSocket';    
import { environment } from '../../environment/environment';   
import { DomSanitizer, SafeHtml, SafeUrl  } from '@angular/platform-browser';   

// Import des modules Angular Material    
import { MatToolbarModule } from '@angular/material/toolbar';    
import { MatIconModule } from '@angular/material/icon';    
import { MatButtonModule } from '@angular/material/button';    
import { MatFormFieldModule } from '@angular/material/form-field';    
import { MatInputModule } from '@angular/material/input';    
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTabChangeEvent } from '@angular/material/tabs';
import { MatTabsModule } from '@angular/material/tabs';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import hljs from 'highlight.js';  
import { EmojiService } from '../services/emoji.service';
import { format, isToday, isYesterday } from 'date-fns';
import { marked } from 'marked';

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
  files_content?: { file_content: string, filename: string, title: string }[]; // For file uploads  
  event_type?: string; // To distinguish message types  
  error?: string; // Add this line for the error property  
  imageUrl?: string;
  message_type?: string;
  title?: string;
}  

interface Message {  
  timestamp: string;  
  thread_id: string;  
  role: string;  
  content: string;  
  is_internal: boolean;  
  reactions: string[];  
  username: string;  
  message_type: string; // Ajout du champ message_type  
  title?: string;       // Pour les codeblocks, s'il y a un titre  
  imageUrl?: string | null;  
  file?: FileAttachment;  
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
    MatProgressSpinnerModule,
    MatSnackBarModule
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
    private snackBar: MatSnackBar,
    private sanitizer: DomSanitizer,
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
    // Handle error messages from the backend  
    if (wsMessage.event_type === 'ERROR') {  
      // Display the error message using MatSnackBar  
      this.snackBar.open(wsMessage.error || 'An error occurred.', 'Close', {  
          duration: 5000,  
          panelClass: ['error-snackbar'],  
          verticalPosition: 'top',  
          horizontalPosition: 'center'  
      });  

      // Reset the waiting states  
      this.isWaitingForResponse = false;  
      this.userStoppedWaiting = false;  

      // Reset any flags or variables related to message processing  
      this.stopProcessingMessages = true; // To cancel processing any pending messages  

      // Update the UI button state  
      this.updateSendButtonState();  

      return;  
    }  

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

  public fileToUrl(file: FileAttachment): string {  
    if (!file.blobUrl) {  
      const decodedContent = this.deSanitizeContent(file.content);  
      const mimeType = this.getFileMimeType(file.filename);  
      const blob = new Blob([decodedContent], { type: mimeType });  
      file.blobUrl = URL.createObjectURL(blob);  
    }  
    return file.blobUrl || '';  
  }  
  
  deSanitizeContent(content: string): string {  
    try {  
      // Supprimer les doubles échappements  
      content = content.replace(/\\\\/g, '\\');  
    
      // Gérer les séquences d'échappement  
      content = content.replace(/\\n/g, '\n')  
                       .replace(/\\r/g, '\r')  
                       .replace(/\\t/g, '\t')  
                       .replace(/\\"/g, '"')  
                       .replace(/\\'/g, "'");  
    
      // Tenter de parser le JSON si applicable  
      if (this.isJsonString(content)) {  
        const parsed = JSON.parse(content);  
        return JSON.stringify(parsed, null, 2);  
      } else {  
        return content;  
      }  
    } catch (e) {  
      console.error('Erreur lors de la désanitation du contenu:', e);  
      return content;  
    }  
  }  

  sanitizeContent(content: string): SafeHtml {  
    return this.sanitizer.bypassSecurityTrustHtml(content);  
  }  
  
  private unescapeContent(content: string): string {  
    return content.replace(/\\\\/g, '\\');  
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
    return this.deSanitizeContent(content);  
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
      case 'yaml': case 'yml': return 'application/x-yaml';  
      case 'jpg': case 'jpeg': return 'image/jpeg';  
      case 'png': return 'image/png';  
      case 'gif': return 'image/gif';  
      case 'svg': return 'image/svg+xml';  
      case 'pdf': return 'application/pdf';  
      default: return 'application/octet-stream';  
    }  
  }  

  getFilePreview(content: string): string {
    const previewLimit = 100;
    return content.length > previewLimit ? content.substring(0, previewLimit) + '...' : content;
  }

  async processMessage(wsMessage: WSMessage): Promise<void> {
    // Stop processing messages if the flag is set
    if (this.stopProcessingMessages) {
      console.log('Message processing is stopped. Ignoring incoming message.');
      return;
    }
  
    console.log('Processing WebSocket message:', wsMessage);
    console.log(`Event Type: ${wsMessage.event_type}`);
  
    // Handle backend errors
    if (wsMessage.event_type === 'ERROR') {
      console.error('Error received from backend:', wsMessage.error);
  
      // Reset waiting states
      this.isWaitingForResponse = false;
      this.userStoppedWaiting = false;
  
      // Update the UI
      this.updateSendButtonState();
  
      return;
    }
  
    // Handle reaction updates
    if (
      wsMessage.event_type === 'REACTION_UPDATE' &&
      (wsMessage.update === 'reaction_add' || wsMessage.update === 'reaction_remove')
    ) {
      console.log('Processing reaction update:', wsMessage);
      const reactionName = wsMessage.reaction_name || '';
  
      if (reactionName === 'done' && wsMessage.update === 'reaction_add') {
        this.isWaitingForResponse = false;
        this.userStoppedWaiting = false;
      }
  
      const message = this.messages.find((msg) => {
        const msgTimestamp = String(msg.timestamp).trim();
        const wsTimestamp = String(wsMessage.timestamp).trim();
        const msgThreadId = String(msg.thread_id).trim();
        const wsThreadId = String(wsMessage.thread_id).trim();
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
  
      return; // Exit after handling reactions
    }
  
    // Handle file uploads
    if (wsMessage.event_type === 'FILE_UPLOAD' && wsMessage.files_content?.length) {
      console.log('Processing FILE_UPLOAD message:', wsMessage);
  
      wsMessage.files_content.forEach((fileContent) => {
        const file: FileAttachment = {
          filename: fileContent.filename,
          title: fileContent.title || fileContent.filename,
          content: fileContent.file_content,
          isExpanded: false,
          blobUrl: '',
        };
  
        this.createBlobUrl(file);
  
        const message: Message = {
          timestamp: String(wsMessage.timestamp!).trim(),
          thread_id: String(wsMessage.thread_id!).trim(),
          role: wsMessage.role?.toLowerCase() || 'assistant',
          content: '', // No text content for file messages
          is_internal: wsMessage.is_internal || false,
          reactions: [],
          username: wsMessage.user_name || 'User',
          file: file,
          message_type: 'file',
        };
  
        this.messages.push(message);
      });
  
      this.shouldScrollToBottom = true;
  
      return; // Exit after handling file uploads
    }
  
    // Handle normal messages
    if (wsMessage.event_type === 'MESSAGE' || wsMessage.event_type === 'MESSAGE_UPDATE') {
      const role = wsMessage.role?.toLowerCase() || 'assistant';
      const username = role === 'user' ? 'User' : 'Remote Bot';
  
      let content = wsMessage.content || wsMessage.text || '';
      let imageUrl: string | null = null;
      let parsedContent: any = null;
  
      if (this.isJsonString(content)) {
        try {
          parsedContent = JSON.parse(content);
          imageUrl = this.extractImageUrlFromJson(parsedContent);
          content = this.extractTextFromJson(parsedContent);
        } catch (e) {
          console.error('Error parsing JSON content:', e);
        }
      } else {
        imageUrl = this.extractImageUrl(content);
      }
  
      const messageType = wsMessage.message_type || 'TEXT';
  
      // Render the markdown content asynchronously
      const renderedMarkdown = await this.renderMarkdown(
        this.processEmojiContent(this.processMentions(content))
      );
  
      const message: Message = {
        timestamp: String(wsMessage.timestamp!).trim(),
        thread_id: String(wsMessage.thread_id!).trim(),
        role: role,
        content: renderedMarkdown, // Store rendered markdown
        is_internal: wsMessage.is_internal || false,
        reactions: [],
        username: wsMessage.user_name || username,
        imageUrl: imageUrl,
        message_type: messageType,
        title: wsMessage.title || '',
      };
  
      console.log('Added message:', message);
      this.messages.push(message);
  
      if (message.role === 'user' && !message.is_internal) {
        this.lastUserMessageTimestamp = message.timestamp;
        this.processPendingReactions(message);
      }
  
      this.shouldScrollToBottom = true;
  
      return; // Exit after handling messages
    }
  
    console.warn(`Unhandled event type: ${wsMessage.event_type}`);
  }
  
  // Helper method to render Markdown
  private async renderMarkdown(content: string): Promise<string> {
    try {
      // Use marked to render markdown content
      return await marked(content);
    } catch (error) {
      console.error('Error rendering markdown:', error);
      return content; // Return original content if rendering fails
    }
  }

  public deserializeContent(content: string): string {  
    try {  
      let previousContent = '';  
      while (content !== previousContent) {  
        previousContent = content;  
        content = content.replace(/\\\\/g, '\\');  
        content = content.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');  
    
        if (this.isJsonString(content)) {  
          content = JSON.parse(content);  
          if (typeof content === 'object') {  
            content = JSON.stringify(content, null, 2);  
          }  
        }  
      }  
    
      return content;  
    
    } catch (e) {  
      console.error('Erreur lors de la désérialisation du contenu:', e);  
      return content;  
    }  
  }  
  
  private isJsonString(str: string): boolean {  
    try {  
      JSON.parse(str);  
      return true;  
    } catch (e) {  
      return false;  
    }  
  }  
  
  private extractImageUrlFromJson(jsonContent: any): string | null {  
    if (!jsonContent) return null;  
    
    // Parcourir le JSON pour trouver l'URL de l'image  
    // Cela dépend de la structure exacte de votre JSON  
    // Exemple basé sur la structure fournie :  
    
    try {  
      const responses = jsonContent.response;  
      if (Array.isArray(responses)) {  
        for (const responseItem of responses) {  
          if (responseItem.Action && responseItem.Action.ActionName === 'GenerateImage') {  
            const parameters = responseItem.Action.Parameters;  
            if (parameters && parameters.ImageUrl) {  
              return parameters.ImageUrl; // Retourner l'URL de l'image  
            }  
          }  
        }  
      }  
    } catch (e) {  
      console.error('Erreur lors de l\'extraction de l\'URL de l\'image du JSON:', e);  
    }  
    return null; // Si l'URL n'est pas trouvée  
  }  
  
  decodeUnicode(input: string): string {  
    return input.replace(/\\u[\dA-Fa-f]{4}/gi, function (match) {  
      return String.fromCharCode(parseInt(match.replace(/\\u/g, ''), 16));  
    });  
  }  

  private extractTextFromJson(jsonContent: any): string {  
    if (!jsonContent) return '';  
    
    // Extraire le texte pertinent du JSON  
    // Par exemple, vous pouvez extraire les observations ou pensées  
    
    try {  
      const responses = jsonContent.response;  
      if (Array.isArray(responses)) {  
        for (const responseItem of responses) {  
          if (responseItem.Action && responseItem.Action.ActionName === 'ObservationThought') {  
            const parameters = responseItem.Action.Parameters;  
            if (parameters && parameters.observation) {  
              return parameters.observation;  
            }  
          }  
        }  
      }  
    } catch (e) {  
      console.error('Erreur lors de l\'extraction du texte du JSON:', e);  
    }  
    return ''; // Si aucun texte n'est trouvé  
  }  
  
  public extractImageUrl(content: string): string | null {  
    const urlPattern = /(https?:\/\/[^\s]+)/g;  
    let match;  
    while ((match = urlPattern.exec(content)) !== null) {  
      const urlWithPossibleSuffix = match[0];  
      const cleanedUrl = this.cleanUrl(urlWithPossibleSuffix);  
      if (this.isImageUrl(cleanedUrl)) {  
        return cleanedUrl;  
      }  
    }  
    return null;  
  }

  private createBlobUrl(file: FileAttachment): void {  
    try {  
      // Vérifier si le contenu est en Base64  
      let binaryContent: Uint8Array;  
      if (this.isBase64(file.content)) {  
        const decodedData = atob(file.content);  
        binaryContent = new Uint8Array(decodedData.length);  
        for (let i = 0; i < decodedData.length; i++) {  
          binaryContent[i] = decodedData.charCodeAt(i);  
        }  
      } else {  
        // Si le contenu est du texte brut  
        binaryContent = new TextEncoder().encode(file.content);  
      }  
    
      // Déterminer le type MIME du fichier  
      const mimeType = this.getFileMimeType(file.filename);  
    
      // Créer le Blob  
      const blob = new Blob([binaryContent], { type: mimeType });  
    
      // Générer l'URL  
      file.blobUrl = URL.createObjectURL(blob);  
    } catch (e) {  
      console.error('Erreur lors de la création de la Blob URL:', e);  
    }  
  }  
  
  private isBase64(str: string): boolean {  
    try {  
      return btoa(atob(str)) === str;  
    } catch (err) {  
      return false;  
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
      thread_id: this.threadId,
      message_type: 'COMMENT',
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
  
  processEmojiContent(content: string): string {
    if (!content) return ''; // Handle empty content gracefully
  
    // Replace newlines with <br> to preserve line breaks
    const withLineBreaks = content.replace(/\n/g, '<br>');
  
    // Convert Slack emoji codes to Unicode using EmojiService
    return this.emojiService.convertSlackEmoji(withLineBreaks);
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

  // Méthode pour vérifier si une URL pointe vers une image  
  public isImageUrl(url: string): boolean {  
    if (!url) return false;  
    // Nettoyer l'URL  
    const cleanedUrl = this.cleanUrl(url.toLowerCase());  
    // Extraire la partie du chemin sans les paramètres de requête et les fragments  
    const urlWithoutParams = cleanedUrl.split('?')[0].split('#')[0];  
    // Extraire l'extension du fichier  
    const extension = urlWithoutParams.split('.').pop();  
    // Vérifier si l'extension correspond à une image  
    return ['jpeg', 'jpg', 'gif', 'png', 'svg', 'bmp', 'webp'].includes(extension || '');  
  }  
  
  public getSafeImageUrl(url: string): SafeUrl {  
    return this.sanitizer.bypassSecurityTrustUrl(url);  
  }  
  

  public cleanUrl(url: string): string {  
    if (!url) return '';  
    // Supprimer '|Image' s'il est présent  
    return url.replace(/\|Image$/, '');  
  }  

  // Méthode pour traiter le contenu du message et détecter les URLs  
  private processMessageContent(content: string): string {  
    const urlRegex = /(https?:\/\/[^\s]+)/g;  
    return content.replace(urlRegex, (url) => {  
      if (this.isImageUrl(url)) {  
        // Remplacer l'URL de l'image par une balise d'image en HTML  
        return `<img src="${url}" alt="Image" />`;  
      } else {  
        // Laisser les autres URLs inchangées ou les transformer en liens cliquables  
        return `<a href="${url}" target="_blank">${url}</a>`;  
      }  
    });  
  }  
}

