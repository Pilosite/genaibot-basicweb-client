import { Component, OnInit } from '@angular/core';  
import { FormsModule } from '@angular/forms';  
import { CommonModule } from '@angular/common';  
import { MarkdownModule } from 'ngx-markdown';  
import { HttpClient } from '@angular/common/http';  
import { WebSocketSubject } from 'rxjs/webSocket';  
  
// Import Angular Material modules  
import { MatToolbarModule } from '@angular/material/toolbar';  
import { MatDividerModule } from '@angular/material/divider';  
import { MatFormFieldModule } from '@angular/material/form-field';  
import { MatInputModule } from '@angular/material/input';  
import { MatButtonModule } from '@angular/material/button';  
import { environment } from '../../environment/environment';

interface Message {  
  role: string;  
  content: string;  
  reactions: string[];  
}  
  
@Component({  
  selector: 'app-chat',  
  templateUrl: './chat.component.html',  
  styleUrls: ['./chat.component.css'],  
  standalone: true,  
  imports: [  
    CommonModule,  
    FormsModule,  
    MarkdownModule,  
    // Add Material modules here  
    MatToolbarModule,  
    MatDividerModule,  
    MatFormFieldModule,  
    MatInputModule,  
    MatButtonModule,  
  ],  
})  
export class ChatComponent implements OnInit {  
  messages: Message[] = [];  
  userInput: string = '';  
  private socket$!: WebSocketSubject<any>;  
  
  constructor(private http: HttpClient) {}  
  
  ngOnInit(): void {  
    this.socket$ = new WebSocketSubject(`${environment.apiUrl.replace('http', 'ws')}/ws`);  
    this.socket$.subscribe({  
      next: (wsMessage) => this.handleSocketMessage(wsMessage),  
      error: (err) => console.error(err),  
      complete: () => console.warn('Completed!'),  
    });  
  }  
  
  handleSocketMessage(wsMessage: any): void {  
    if (wsMessage.update === 'reaction') {  
      const index: number = wsMessage.message_index;  
      const reactions: string[] = wsMessage.reactions || [];  
      if (this.messages[index]) {  
        this.messages[index].reactions = reactions;  
      }  
    } else {  
      const message: Message = {  
        role: wsMessage.role || 'assistant',  
        content: wsMessage.content || '',  
        reactions: wsMessage.reactions || [],  
      };  
      this.messages.push(message);  
    }  
  }  
  
  sendMessage(): void {  
    if (this.userInput.trim() === '') return;  
    const userMessage: Message = {  
      role: 'user',  
      content: this.userInput,  
      reactions: []  
    };  
    this.messages.push(userMessage);  
    this.http.post(`${environment.apiUrl}/api/send_message`, userMessage).subscribe(); 
    this.userInput = '';  
  }  
  
  addReaction(messageIndex: number, event: Event): void {  
    const target = event.target as HTMLSelectElement;  
    const reaction = target.value;  
    if (reaction === '') return;  
    this.http.post('/api/add_reaction', { message_index: messageIndex, reaction }).subscribe();  
  }  
}  
