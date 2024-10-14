// app.config.ts  
import { ApplicationConfig } from '@angular/core';  
import { provideHttpClient } from '@angular/common/http';  
import { provideMarkdown } from 'ngx-markdown';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';  
  
export const appConfig: ApplicationConfig = {  
  providers: [  
    provideHttpClient(),  
    provideMarkdown(), provideAnimationsAsync(),  
    // Ajoutez d'autres providers globaux si nécessaire  
  ],  
};  
