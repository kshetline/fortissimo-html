import { HttpClient } from '@angular/common/http';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { addCopyListener, formatHtml, HtmlParser, stylizeHtml, ValueQuoteStyle, ValueQuoting } from '../../fortissimo-html/src';
// import { isEqual } from 'lodash';
// import { MenuItem } from 'primeng/api';

import { DEFAULT_PREFERENCES, Preferences, PreferencesService } from './preferences.service';
// import { getCssValue, toNumber } from '@tubular/util';

function screenTooSmallForTooltip(): boolean {
  return window.innerWidth < 480 || window.innerHeight < 480;
}

@Component({
  selector: 'fh-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnDestroy, OnInit {
  private _detailsCollapsed = false;
  private _indent = '0';
  private needsMouseLeave: HTMLElement;

  private clickListener = (): void => {
    if (this.needsMouseLeave) {
      this.needsMouseLeave.dispatchEvent(new MouseEvent('mouseleave'));
      this.needsMouseLeave = undefined;
    }
  };

  quoting = [
    { label: 'LEAVE_AS_IS', value: ValueQuoting.LEAVE_AS_IS },
    { label: 'ALWAYS_QUOTE', value: ValueQuoting.ALWAYS_QUOTE },
    { label: 'UNQUOTE_INTEGERS', value: ValueQuoting.UNQUOTE_INTEGERS },
    { label: 'UNQUOTE_SIMPLE_VALUES', value: ValueQuoting.UNQUOTE_SIMPLE_VALUES }
  ];

  quoteStyle = [
    { label: 'PREFER_DOUBLE', value: ValueQuoteStyle.PREFER_DOUBLE },
    { label: 'PREFER_SINGLE', value: ValueQuoteStyle.PREFER_SINGLE },
    { label: 'DOUBLE', value: ValueQuoteStyle.DOUBLE },
    { label: 'SINGLE', value: ValueQuoteStyle.SINGLE }
  ];

  banner: SafeHtml;
  endsInNewLine = false;
  indentError = false;
  inputInfo = '(tbd)';
  output: SafeHtml | string = '';
  prefs: Preferences;
  showInputInfo = false;
  source = '';

  get detailsCollapsed(): boolean { return this._detailsCollapsed; }
  set detailsCollapsed(newValue: boolean) {
    if (this._detailsCollapsed !== newValue) {
      this._detailsCollapsed = newValue;
      this.updatePrefs();
    }
  }

  get indent(): string { return this._indent; }
  set indent(newValue: string) {
    if (this._indent !== newValue)
      this._indent = newValue;

    const value = newValue ? Number(newValue) : 0;

    if (0 <= value && value <= 10) {
      this.prefs.indent = value;
      this.indentError = false;
    }
    else
      this.indentError = true;
  }

  constructor(
    private http: HttpClient,
    private prefsService: PreferencesService,
    private sanitizer: DomSanitizer
  ) {
    http.get('assets/banner.html', { responseType: 'text' })
      .subscribe(content => this.banner = sanitizer.bypassSecurityTrustHtml(content.toString()));

    this.prefs = prefsService.get() || DEFAULT_PREFERENCES;

    Object.keys(DEFAULT_PREFERENCES).forEach(key => {
      if (!(key in this.prefs))
        this.prefs[key] = DEFAULT_PREFERENCES[key];
    });

    this._detailsCollapsed = !!this.prefs.detailsCollapsed;
    this._indent = (this.prefs.indent || 0).toString();
    this.source = this.prefs.source || '';
  }

  ngOnInit(): void {
    document.addEventListener('click', this.clickListener);
    this.onChange(false, false);
  }

  ngOnDestroy(): void {
    document.removeEventListener('click', this.clickListener);
  }

  touchToHover(event: TouchEvent): void {
    event.preventDefault();

    if (screenTooSmallForTooltip())
      this.showInputInfo = true;
    else if (this.needsMouseLeave) {
      this.needsMouseLeave.dispatchEvent(new MouseEvent('mouseleave'));
      this.needsMouseLeave = undefined;
    }
    else {
      this.needsMouseLeave = event.target as HTMLElement;
      this.needsMouseLeave.dispatchEvent(new MouseEvent('mouseenter'));
    }
  }

  clearSource(): void {
    this.source = '';
    this.onChange();
  }

  onChange(_delayError = false, updateThePrefs = true): void {
    if (updateThePrefs) {
      this.prefs.source = this.source;
      this.updatePrefs();
    }

    const parser = new HtmlParser();
    const dom = parser.parse(this.source).domRoot;

    if (this.prefs.reformat)
      formatHtml(dom, {
        endDocumentWithNewline: true,
        indent: this.prefs.indent,
        trimDocument: true,
        valueQuoteStyle: this.prefs.quoteStyle,
        valueQuoting: this.prefs.quoting
      });

    // console.log(dom.getLineMap());

    if (this.prefs.colorize) {
      const styled = stylizeHtml(dom, {
        dark: this.prefs.darkMode,
        includeCopyScript: false,
        outerTag: 'div',
        showWhitespace: this.prefs.showWhitespace
      });
      this.output = this.sanitizer.bypassSecurityTrustHtml(styled);
      this.endsInNewLine = /([\r\n]<\/span>|<\/span>[\r\n]+)<\/div>$/.test(styled);

      if (this.prefs.showWhitespace)
        setTimeout(addCopyListener);
    }
    else {
      this.output = dom.toString();
      this.endsInNewLine = /[\r\n]$/.test(this.output as string);
    }
  }

  onPaste(event: ClipboardEvent): void {
    const paste = (event.clipboardData || (window as any).clipboardData).getData('text');

    if (/^http(s?):\/\/.+/i.test(paste)) {
      event.preventDefault();

      const script = document.createElement('script');

      // script.setAttribute('type', 'text/html');

      script.onload = (): void => {
        this.source = script.innerHTML;
        document.head.removeChild(script);
      };

      script.onerror = (): void => {
        document.head.removeChild(script);
      };

      script.src = paste;
      document.head.appendChild(script);
    }
  }

  updatePrefs(): void {
    this.prefsService.set(this.prefs);
  }

  onScroll(evt: Event): void {
    const target = evt.target as HTMLElement;
    const other = (target.id === 'source-elem' ? document.getElementById('output-elem-1') ||
                   document.getElementById('output-elem-2') : document.getElementById('source-elem'));
    // const lineHeight = toNumber(getCssValue(target, 'line-height').replace('px', ''));

    other.scrollTo(other.scrollLeft, target.scrollTop);
  }
}
