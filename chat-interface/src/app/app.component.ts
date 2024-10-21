// app.component.ts  
import { Component, OnInit, HostListener, ViewChild } from '@angular/core';  
import { CommonModule } from '@angular/common';  
import { ChatComponent } from './chat/chat.component';  
import { PromptDesignerComponent } from './prompt-designer/prompt-designer.component';  
import { MatToolbarModule } from '@angular/material/toolbar';  
import { MatIconModule } from '@angular/material/icon';       // Importer MatIconModule  
import { MatButtonModule } from '@angular/material/button';   // Importer MatButtonModule  
import { RouterModule } from '@angular/router';  
  
@Component({  
  selector: 'app-root',  
  templateUrl: './app.component.html', // Utiliser un fichier HTML séparé  
  styleUrls: ['./app.component.css'],  
  standalone: true,  
  imports: [  
    CommonModule,  
    MatToolbarModule,  
    MatIconModule,      // Ajouter MatIconModule aux imports  
    MatButtonModule,    // Ajouter MatButtonModule aux imports  
    RouterModule,  
    ChatComponent,  
    PromptDesignerComponent,  
  ],  
})  
export class AppComponent {  
  @ViewChild(ChatComponent) chatComponent!: ChatComponent;  
  
  showDesignerPanel: boolean = false; // Masqué par défaut  
  showInternalMessages: boolean = true;  
  
  designerWidth: number = window.innerWidth / 2;  
  designerMinWidth: number = 200;  
  chatMinWidth: number = 300;  
  splitterWidth: number = 5;  
  designerMaxWidth: number = window.innerWidth - this.chatMinWidth - this.splitterWidth;  
  isSplitterDragging: boolean = false;  
  
  @HostListener('window:resize', ['$event'])  
  onWindowResize(event: Event) {  
    this.designerMaxWidth = window.innerWidth - this.chatMinWidth - this.splitterWidth;  
    if (this.designerWidth > this.designerMaxWidth) {  
      this.designerWidth = this.designerMaxWidth;  
    }  
  }  
  
  toggleDesignerPanel(): void {  
    this.showDesignerPanel = !this.showDesignerPanel;  
    if (this.showDesignerPanel) {  
      this.designerWidth = window.innerWidth / 2;  
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
  
  // Méthodes pour les boutons de la barre d'outils  
  
  toggleInternalMessages(): void {  
    this.showInternalMessages = !this.showInternalMessages;  
    // Communiquer avec le ChatComponent pour mettre à jour l'affichage des messages internes  
    if (this.chatComponent) {  
      this.chatComponent.showInternalMessages = this.showInternalMessages;  
    }  
  }  
  
  resetConversation(): void {  
    // Appeler la méthode resetConversation du ChatComponent  
    if (this.chatComponent) {  
      this.chatComponent.resetConversation();  
    }  
  }  
}  
