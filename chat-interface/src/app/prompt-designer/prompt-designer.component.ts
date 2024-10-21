// src/app/prompt-designer/prompt-designer.component.ts  
import { Component, OnInit } from '@angular/core';  
import { CommonModule } from '@angular/common';  
import { FormsModule } from '@angular/forms';  
import { MatTabsModule, MatTabChangeEvent } from '@angular/material/tabs';  
import { MatFormFieldModule } from '@angular/material/form-field';  
import { MatInputModule } from '@angular/material/input';  
import { MatSpinner, MatProgressSpinnerModule } from '@angular/material/progress-spinner';  
import { HttpClient } from '@angular/common/http';  
import { MatSelectModule } from '@angular/material/select';  
import { MatButtonModule } from '@angular/material/button';  
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';  
  
import { environment } from '../../environment/environment';  
  
@Component({  
  selector: 'app-prompt-designer',  
  templateUrl: './prompt-designer.component.html',  
  styleUrls: ['./prompt-designer.component.css'],  
  standalone: true,  
  imports: [  
    CommonModule,  
    FormsModule,  
    MatTabsModule,  
    MatFormFieldModule,  
    MatInputModule,  
    MatProgressSpinnerModule,  
    MatSelectModule,  
    MatButtonModule,  
    MatSnackBarModule,  
  ],  
})  
export class PromptDesignerComponent implements OnInit {  
  selectedTabIndex: number = 0;  
  promptContent: string = '';  
  loadingPrompt: boolean = false;  
  
  // Gestion des subprompts  
  availableSubprompts: string[] = [];  
  selectedSubprompt: string = '';  
  
  constructor(private http: HttpClient, private snackBar: MatSnackBar) {}  
  
  ngOnInit(): void {  
    this.loadAvailableSubprompts();  
    this.loadPromptForSelectedTab();  
  }  
  
  onTabChange(event: MatTabChangeEvent): void {  
    this.selectedTabIndex = event.index;  
    this.loadPromptForSelectedTab();  
  }  
  
  loadPromptForSelectedTab(): void {  
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
        this.promptContent = '';  
      }  
    }  
  }  
  
  loadPrompt(promptType: string, promptName: string | null): void {  
    this.loadingPrompt = true;  
    const params: { [param: string]: string } = {  
      prompt_type: promptType,  
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
        this.snackBar.open('Error loading prompt', 'Close', { duration: 3000 });  
      },  
    });  
  }  
  
  savePrompt(): void {  
    this.loadingPrompt = true;  
    const promptType =  
      this.selectedTabIndex === 0 ? 'core' : this.selectedTabIndex === 1 ? 'main' : 'subprompt';  
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
        this.snackBar.open('Prompt saved successfully', 'Close', { duration: 3000 });  
      },  
      error: (error) => {  
        console.error('Error saving prompt:', error);  
        this.loadingPrompt = false;  
        this.snackBar.open('Error saving prompt', 'Close', { duration: 3000 });  
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
            this.snackBar.open('Error creating subprompt', 'Close', { duration: 3000 });  
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
            this.snackBar.open('Error deleting subprompt', 'Close', { duration: 3000 });  
          },  
        });  
    }  
  }  
}  
