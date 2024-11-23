import { Injectable } from '@angular/core';
import { emojiMap } from '../utils/emoji-map'; // Ensure this contains all Slack emoji mappings

@Injectable({
  providedIn: 'root',
})
export class EmojiService {
  constructor() {}

  /**
   * Convert Slack emoji names to Unicode.
   */
  convertSlackEmoji(text: string): string {
    return text.replace(/:([a-zA-Z0-9_\-+]+):/g, (match, p1) => {
      return emojiMap[p1] || match; // Replace with Unicode emoji or keep original
    });
  }
}
