import { KeyCombinationError } from './input-errors.js';
import type { WorkflowStep } from './types.js';

/**
 * Result of parsing a key combination string.
 */
export interface KeyParts {
  modifiers: string[];
  key: string;
}

/**
 * Maps key names and combinations across different platforms.
 * Handles Windows, macOS, and Linux differences (e.g., cmd vs ctrl).
 */
export class KeyboardMapper {
  /**
   * Parse a key combination string into modifiers and key.
   * Example: "ctrl+shift+c" → { modifiers: ['ctrl', 'shift'], key: 'c' }
   */
  parseKeyCombo(combo: string): KeyParts {
    const parts = combo.toLowerCase().split('+').map(s => s.trim());
    const key = parts[parts.length - 1];
    const modifiers = parts.slice(0, -1);

    // Normalize modifier order: ctrl < alt < shift < cmd
    const modifierOrder: Record<string, number> = {
      ctrl: 0,
      alt: 1,
      shift: 2,
      cmd: 3,
      option: 4,
      super: 5,
      win: 6,
    };

    modifiers.sort((a, b) => (modifierOrder[a] ?? 99) - (modifierOrder[b] ?? 99));

    return { modifiers, key };
  }

  /**
   * Map a modifier name to its platform-specific equivalent.
   */
  private platformModifierName(mod: string, platform: string): string {
    switch (mod) {
      case 'ctrl':
      case 'control':
        return 'ctrl';
      case 'alt':
      case 'option':
        return platform === 'darwin' ? 'option' : 'alt';
      case 'cmd':
      case 'command':
        return platform === 'darwin' ? 'cmd' : 'ctrl';
      case 'super':
      case 'win':
      case 'windows':
        return platform === 'win32' ? 'win' : platform === 'darwin' ? 'cmd' : 'super';
      case 'shift':
        return 'shift';
      default:
        return mod;
    }
  }

  /**
   * Check if a key combination is valid for the given platform.
   */
  private isLegalCombo(modifiers: string[], key: string, platform: string): boolean {
    // Some combos are not available on certain platforms
    if (platform === 'darwin') {
      // macOS doesn't support win key
      if (modifiers.includes('win')) return false;
    }
    // Add more platform-specific rules as needed
    return true;
  }

  /**
   * Map a key combination to its platform-specific equivalent.
   * Example: "cmd+c" → "cmd+c" on macOS, "ctrl+c" on Windows
   */
  mapKeyCombo(combo: string, platform: string): string {
    const { modifiers, key } = this.parseKeyCombo(combo);
    const mappedModifiers = modifiers.map(m => this.platformModifierName(m, platform));

    if (!this.isLegalCombo(mappedModifiers, key, platform)) {
      const suggestions = this.suggestAlternative(combo, platform);
      const step: WorkflowStep = { id: 'temp', name: combo, action: 'key', x: 0, y: 0, status: 'pending' };
      throw new KeyCombinationError(
        `Key combination "${combo}" not available on ${platform}`,
        step,
        combo,
        suggestions
      );
    }

    return [...mappedModifiers, key].join('+');
  }

  /**
   * Suggest an alternative key combination for the target platform.
   */
  private suggestAlternative(combo: string, platform: string): string[] {
    const { modifiers, key } = this.parseKeyCombo(combo);

    if (platform === 'darwin' && modifiers.includes('win')) {
      // Windows key on macOS → suggest cmd
      const alt = modifiers.filter(m => m !== 'win').map(m => this.platformModifierName(m, platform));
      return [[...alt, 'cmd', key].join('+')];
    }

    if (platform !== 'darwin' && modifiers.some(m => m === 'cmd' || m === 'command')) {
      // cmd on non-macOS → suggest ctrl
      const alt = modifiers
        .filter(m => m !== 'cmd' && m !== 'command')
        .map(m => this.platformModifierName(m, platform));
      return [[...alt, 'ctrl', key].join('+')];
    }

    return [];
  }
}
