import { Injectable } from '@angular/core';
import { ValueQuoteStyle, ValueQuoting } from 'lib/src/index';
import { cloneDeep, debounce } from 'lodash';

export interface Preferences {
  colorize?: boolean;
  continuationIndent?: number;
  darkMode?: boolean;
  detailsCollapsed?: boolean;
  indent?: number;
  reformat?: boolean;
  showWhitespace?: boolean;
  source?: string;
  quoteStyle?: ValueQuoteStyle;
  quoting?: ValueQuoting;
  tabSize?: 8;
}

export const DEFAULT_PREFERENCES = {
  colorize: true,
  darkMode: true,
  detailsCollapsed: false,
  endDocumentWithNewline: true,
  indent: 0,
  reformat: false,
  showWhitespace: false,
  source: '',
  quoteStyle: ValueQuoteStyle.PREFER_DOUBLE,
  quoting: ValueQuoting.LEAVE_AS_IS
};

@Injectable()
export class PreferencesService {
  private prefs: Preferences;
  private debouncedSaveSettings = debounce(() =>
    localStorage.setItem('ffhtml-prefs', JSON.stringify(this.prefs)), 2000);

  constructor() {
    const prefsStr = localStorage.getItem('ffhtml-prefs');

    if (prefsStr) {
      try {
        this.prefs = JSON.parse(prefsStr);

        if (!this.prefs || (typeof this.prefs !== 'object'))
          this.prefs = DEFAULT_PREFERENCES;
      }
      catch (err) {}
    }
  }

  get(): Preferences {
    return this.prefs && cloneDeep(this.prefs);
  }

  set(newPrefs: Preferences): void {
    this.prefs = newPrefs && cloneDeep(newPrefs) || DEFAULT_PREFERENCES;
    this.debouncedSaveSettings();
  }
}
