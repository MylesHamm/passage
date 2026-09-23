// TradingView owns the cross-origin chart, its quote timestamps and market status.
// Passage never reads its prices, infers freshness from iframe load, or exports them.
// https://www.tradingview.com/widget-docs/faq/data/
(() => {
  const origin = 'https://www.tradingview-widget.com';
  const config = {
    symbols: [['Brent', 'TVC:UKOIL|1D'], ['WTI', 'TVC:USOIL|1D']],
    chartOnly: false, width: '100%', height: '100%', locale: 'en',
    colorTheme: 'dark', autosize: true, showVolume: false, showMA: false,
    hideDateRanges: false, hideMarketStatus: false, hideSymbolLogo: true,
    scalePosition: 'right', scaleMode: 'Normal', fontFamily: 'Arial, sans-serif',
    fontSize: '12', noTimeScale: false, valuesTracking: '1',
    changeMode: 'price-and-percent', chartType: 'area', lineWidth: 2,
    lineType: 0, dateRanges: ['1d|1', '1m|1D', '3m|60'], dateRange: '1D',
  };

  class OilQuotes extends HTMLElement {
    static observedAttributes = ['paused'];

    attributeChangedCallback(name, previous, value) {
      if (name === 'paused' && previous !== value && this.connected) this.openChart();
    }

    connectedCallback() {
      if (this.connected) return;
      this.connected = true;
      this.innerHTML = `<div class="oil-intraday-heading"><div><span class="eyebrow">INTRADAY MARKET</span><p>Brent &amp; WTI <span>· CFD quotes</span></p></div><button type="button" class="text-button" data-quote-retry aria-label="Reload Brent and WTI chart">Reload ↻</button></div>
        <div class="oil-provider-chart" data-quote-frame></div>
        <p class="oil-provider-status" data-quote-status role="status" aria-live="polite"></p>
        <p class="oil-provider-credit"><a href="https://www.tradingview.com/markets/commodities/" target="_blank" rel="noopener noreferrer">Oil market charts by TradingView ↗</a></p>
        <details class="oil-quote-notes"><summary>Quote timing &amp; sources</summary><p>Quotes update during market hours. The chart shows market-open or market-closed status. Quote age and any exchange delay cannot be independently verified by Passage. Open the timestamped quote views below to inspect the provider’s displayed time.</p><p>These are TradingView’s oil-linked CFDs, not physical spot prices or exchange futures. They are not included in Passage alerts or exports. EIA spot history remains separately dated below.</p><p>If the chart is blank, unavailable or appears frozen, reload it or open the source:</p><div class="oil-provider-links"><a href="https://www.tradingview-widget.com/embed-widget/symbol-info/?locale=en&amp;symbol=TVC%3AUKOIL" target="_blank" rel="noopener noreferrer">Brent · quote time ↗</a><a href="https://www.tradingview-widget.com/embed-widget/symbol-info/?locale=en&amp;symbol=TVC%3AUSOIL" target="_blank" rel="noopener noreferrer">WTI · quote time ↗</a><a href="https://www.cmegroup.com/market-data/browse-data/delayed-quotes.html" target="_blank" rel="noopener noreferrer">CME futures · ≥10 min delay ↗</a></div></details>`;
      this.host = this.querySelector('[data-quote-frame]');
      this.status = this.querySelector('[data-quote-status]');
      this.retry = this.querySelector('[data-quote-retry]');
      this.open = () => this.openChart();
      this.offline = () => this.fail('Offline · intraday quotes paused. Reconnect or use the dated EIA history below.');
      this.blocked = event => {
        if (event.effectiveDirective === 'frame-src' && event.blockedURI?.startsWith(origin)) {
          this.fail('Embedded chart blocked. Open a quote source below or restart Passage after updating.');
        }
      };
      this.retry.addEventListener('click', this.open);
      window.addEventListener('online', this.open);
      window.addEventListener('offline', this.offline);
      window.addEventListener('securitypolicyviolation', this.blocked);
      this.openChart();
    }

    clear() {
      clearTimeout(this.timer);
      this.timer = null;
      this.frame = null;
      if (this.host) {
        this.host.replaceChildren();
        this.host.hidden = true;
      }
    }

    pauseChart() {
      this.clear();
      this.dataset.quoteState = 'paused';
      this.retry.disabled = true;
      this.status.textContent = 'Intraday quotes paused and hidden. Turn on Auto refresh to reopen the provider chart.';
    }

    fail(message) {
      if (!this.connected) return;
      if (this.hasAttribute('paused')) return this.pauseChart();
      this.clear();
      this.dataset.quoteState = 'unavailable';
      this.status.textContent = message;
      this.querySelector('.oil-quote-notes')?.setAttribute('open', '');
    }

    openChart() {
      if (!this.connected) return;
      if (this.hasAttribute('paused')) return this.pauseChart();
      this.clear();
      this.retry.disabled = false;
      if (navigator.onLine === false) return this.offline();
      this.host.hidden = false;
      this.dataset.quoteState = 'loading';
      this.status.textContent = 'Opening the intraday chart…';
      const frame = document.createElement('iframe');
      this.frame = frame;
      frame.title = 'Brent and WTI intraday CFD prices from TradingView';
      frame.referrerPolicy = 'no-referrer';
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox');
      frame.src = `${origin}/embed-widget/symbol-overview/?locale=en#${encodeURIComponent(JSON.stringify(config))}`;
      frame.addEventListener('load', () => {
        if (this.frame !== frame) return;
        clearTimeout(this.timer);
        this.dataset.quoteState = 'display';
        // A loaded frame may still contain the provider's error screen.
        this.status.textContent = 'Check the chart’s market status; timestamped quote views are linked below.';
      });
      frame.addEventListener('error', () => {
        if (this.frame === frame) this.fail('The intraday chart could not open. Reload or open a quote source below.');
      });
      this.timer = setTimeout(() => {
        if (this.frame !== frame) return;
        this.dataset.quoteState = 'slow';
        this.status.textContent = 'The chart is taking longer than usual. Reload or open a quote source below.';
        this.querySelector('.oil-quote-notes')?.setAttribute('open', '');
      }, 15000);
      this.host.replaceChildren(frame);
    }

    disconnectedCallback() {
      this.connected = false;
      this.clear();
      this.retry?.removeEventListener('click', this.open);
      window.removeEventListener('online', this.open);
      window.removeEventListener('offline', this.offline);
      window.removeEventListener('securitypolicyviolation', this.blocked);
    }
  }
  customElements.define('passage-oil-quotes', OilQuotes);
})();
