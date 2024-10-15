import { ApplicationConfig } from '@angular/core';  
import { provideHttpClient } from '@angular/common/http';  
import { provideMarkdown, MARKED_OPTIONS } from 'ngx-markdown';  
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';  

export const appConfig: ApplicationConfig = {    
  providers: [    
      provideHttpClient(),    
      provideMarkdown(), // Appelez provideMarkdown sans paramètres supplémentaires  
      {  
          provide: MARKED_OPTIONS,  
          useValue: {  
              gfm: true, // Activer GitHub Flavored Markdown  
              emoji: true, // Activer les emojis  
          },  
      },  
      provideAnimationsAsync(),    
  ],    
};  
