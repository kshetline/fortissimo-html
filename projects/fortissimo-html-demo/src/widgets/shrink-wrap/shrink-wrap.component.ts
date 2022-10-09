import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnDestroy, OnInit, Output, ViewChild } from '@angular/core';
import { addResizeListener, removeResizeListener } from 'detect-resize';
import { debounce } from 'lodash';

const docElem = document.documentElement;
const DEFAULT_MIN = 0.75;

// This component fails to work (sometimes in a very dramatic fashion, with the content it's
// supposed to be showing doing a dramatic animated dive off the screen!) on the original
// non-Chromium version of Microsoft Edge. Therefore, we want to disable it for that browser.
// At the time of this writing, the user agent string for the original Edge has the word
// "Edge" fully spelled out, while the beta Chromium Edge simply has "Edg". If that changes
// in the future, the test for Edge below will have to be updated.
//
// It also doesn't work on IE.

const NOT_SUPPORTED = / Edge\//.test(navigator.userAgent) ||
                      /(?:\b(MS)?IE\s+|\bTrident\/7\.0;.*\s+rv:)(\d+)/.test(navigator.userAgent);

@Component({
  selector: 'ks-shrink-wrap',
  templateUrl: './shrink-wrap.component.html',
  styleUrls: ['./shrink-wrap.component.scss']
})
export class ShrinkWrapComponent implements AfterViewInit, OnDestroy, OnInit {
  private afterInit = false;
  private _boundingElement: HTMLElement = docElem;
  private _minScale = DEFAULT_MIN;
  private inner: HTMLDivElement;
  private sizer: HTMLDivElement;
  private thresholdSizer: HTMLDivElement;
  private lastWidth = 0;
  private lastHeight = 0;
  private lastSizerWidth = 0;
  private thresholdWidth: number;

  innerStyle: any = {};
  marginX = 0;
  marginY = 0;
  outerStyle: any = {};
  scale = 1;
  thresholdStyle: any = {};

  @ViewChild('inner', { static: true }) innerRef: ElementRef;
  @ViewChild('sizer', { static: true }) sizerRef: ElementRef;
  @ViewChild('thresholdSizer', { static: true }) thresholdSizerRef: ElementRef;

  @Input() get minScale(): number | string { return this._minScale; }
  set minScale(newValue: number | string) {
    if (typeof newValue as any === 'string') {
      const $ = /([\d.]+)(%)?/.exec(newValue as any as string);

      if ($) {
        newValue = Number($[1]);

        if ($[2])
          newValue /= 100;
      }
      else
        newValue = DEFAULT_MIN;
    }

    if (isNaN(newValue as number) || !newValue)
      this._minScale = DEFAULT_MIN;
    else
      this._minScale = Math.min(Math.max(newValue as number, 0.01), 1);
  }

  // eslint-disable-next-line accessor-pairs
  @Input() set boundingElement(newValue: string | HTMLElement) {
    if (!newValue)
      newValue = docElem;
    else if (typeof newValue === 'string')
      newValue = document.getElementById(newValue);

    if (this._boundingElement !== newValue) {
      this.removeResizeListener(this._boundingElement);
      this._boundingElement = newValue;

      if (!NOT_SUPPORTED) {
        this.addResizeListener(this._boundingElement);

        if (this.afterInit)
          setTimeout(() => this.onResize());
      }
    }
  }

  // eslint-disable-next-line accessor-pairs
  @Input() set threshold(newValue: number | string) {
    let changed = false;

    if (typeof newValue === 'number' || !isNaN(Number(newValue))) {
      newValue = Number(newValue);

      if (this.thresholdWidth !== newValue) {
        this.thresholdWidth = newValue;
        this.thresholdStyle = {};
        changed = true;
      }
    }
    else if (this.thresholdStyle.width !== newValue) {
      this.thresholdStyle = newValue && !NOT_SUPPORTED ? { width: newValue } : {};
      this.thresholdWidth = undefined;
      changed = true;
    }

    if (changed) {
      this.lastSizerWidth = 0;

      if (this.afterInit && !NOT_SUPPORTED)
        setTimeout(() => this.onResize());
    }
  }

  @Output() scaleChange = new EventEmitter<number>();

  onResize = debounce(() => {
    const innerWidth = this.inner.clientWidth - this.marginX * 2;
    const innerHeight = this.inner.clientHeight - this.marginY;
    const boundingWidth = this.getBoundingWidth();
    let sizerWidth = this.sizer.clientWidth;

    this.outerStyle = this.outerStyle.padding ? { padding: this.outerStyle.padding } : {};

    if (this._boundingElement === docElem)
      sizerWidth = Math.min(sizerWidth, boundingWidth);
    else {
      sizerWidth = boundingWidth;
      this.outerStyle['max-width'] = boundingWidth + 'px';
    }

    if (Math.abs(sizerWidth - this.lastSizerWidth) <= 1 &&
        Math.abs(innerWidth - this.lastWidth) <= 1 &&
        Math.abs(innerHeight - this.lastHeight) <= 1) {
      return;
    }

    let scalingWidth = innerWidth;

    if (this.thresholdStyle.width)
      scalingWidth = this.thresholdSizer.getBoundingClientRect().width;
    else if (!this.thresholdWidth && scalingWidth > sizerWidth)
      this.thresholdWidth = scalingWidth;
    else if (this.thresholdWidth)
      scalingWidth = this.thresholdWidth;

    // Compensation, if needed, for the 0.05px padding used to prevent margin collapse.
    const sizerAdjust = (sizerWidth < scalingWidth)  ? 0.1 : 0;

    this.scale = Math.min(Math.max((sizerWidth - sizerAdjust) / scalingWidth, this.minScale as number), 1);

    const scaledWidth = scalingWidth * this.scale;
    const scaledHeight = scaledWidth * innerHeight / innerWidth;

    this.marginX = this.scale === 1 ? 0 : Math.ceil((scaledWidth - innerWidth) / 2);
    this.marginY = this.scale === 1 ? 0 : Math.ceil(scaledHeight - innerHeight);

    this.lastWidth = innerWidth;
    this.lastHeight = innerHeight;
    this.lastSizerWidth = sizerWidth;

    if (this.scale === 1) {
      this.innerStyle = {};
      delete this.outerStyle.padding;
    }
    else {
      this.innerStyle = {
        transform: `scale(${this.scale})`,
        'transform-origin': 'top center',
        margin: `0 ${this.marginX}px ${this.marginY}px ${this.marginX}px`,
        'max-width': `${scalingWidth}px`
      };
      this.outerStyle.padding = '0.05px'; // prevents margin collapse
    }

    this.scaleChange.emit(this.scale);
  }, 10);

  ngOnInit(): void {
    this.inner = this.innerRef.nativeElement;
    this.sizer = this.sizerRef.nativeElement;
    this.thresholdSizer = this.thresholdSizerRef.nativeElement;

    if (NOT_SUPPORTED)
      return;

    this.addResizeListener(this.inner);
    this.addResizeListener(this.sizer);
    this.addResizeListener(this.thresholdSizer);
    this.addResizeListener(this._boundingElement);
    window.addEventListener('resize', this.onResize);
  }

  ngAfterViewInit(): void {
    this.afterInit = true;

    if (NOT_SUPPORTED)
      return;

    setTimeout(() => this.onResize());
  }

  ngOnDestroy(): void {
    if (NOT_SUPPORTED)
      return;

    this.removeResizeListener(this.inner);
    this.removeResizeListener(this.sizer);
    this.removeResizeListener(this.thresholdSizer);
    this.removeResizeListener(this._boundingElement);
    window.removeEventListener('resize', this.onResize);
  }

  getBoundingWidth(): number {
    let elem = this._boundingElement;

    let width = elem.clientWidth;
    const isDocElem = (elem === docElem);

    if (isDocElem)
      elem = document.body;

    const style = window.getComputedStyle(elem, null);
    const contentBox = style.getPropertyValue('box-sizing') === 'content-box';

    if (isDocElem)
      width -= parseFloat(style.getPropertyValue('margin-left') || '0') +
               parseFloat(style.getPropertyValue('margin-right') || '0');

    if (contentBox)
      width -= parseFloat(style.getPropertyValue('border-left-width') || '0') +
               parseFloat(style.getPropertyValue('border-right-width') || '0');

    return width;
  }

  private addResizeListener(elem): void {
    if (elem !== docElem)
      addResizeListener(elem, this.onResize);
  }

  private removeResizeListener(elem): void {
    if (elem !== docElem)
      removeResizeListener(elem, this.onResize);
  }
}
