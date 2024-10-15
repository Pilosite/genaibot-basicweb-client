import { Injectable } from '@angular/core';
import * as emojione from 'emojione';

@Injectable({
  providedIn: 'root'
})
export class EmojiService {

  constructor() {}

  // Méthode pour convertir les codes emojis en vrais emojis
  convert(text: string): string {
    return emojione.shortnameToUnicode(text);  // Convertit les shortcodes en emojis
  }
}
