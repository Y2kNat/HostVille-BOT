'use strict';

class WebSearch {

    /**
     * Buscar resultados na web (sem chave de API).
     * Usa DuckDuckGo HTML como fonte principal e a API Wikipedia como fallback.
     * @param {string} query - pergunta/palavras-chave
     * @param {number} [limit] - quantidade de resultados
     * @returns {Promise<string|null>} texto formatado com os resultados ou null em falha
     */
    static async search(query, limit = 3) {
        const ddg = await this._duckDuckGo(query, limit);
        if (ddg) return ddg;

        const wiki = await this._wikipedia(query, limit);
        if (wiki) return wiki;

        return null;
    }

    static _clean(htmlText) {
        return htmlText
            .replace(/<[^>]+>/g, '')
            .replace(/&#x27;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&gt;/g, '>')
            .replace(/&lt;/g, '<')
            .replace(/&#x2F;/g, '/')
            .replace(/&nbsp;/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    static async _duckDuckGo(query, limit) {
        try {
            const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);
            const res = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml'
                },
                signal: AbortSignal.timeout(8000)
            });
            if (!res.ok || res.status !== 200) return null;
            const html = await res.text();
            if (!html || html.length < 300) return null;

            // Títulos completos primeiro, depois snippets
            const titleRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gis;
            const snipRe = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>(.*?)<\/a>/gis;

            const titles = [];
            const snippets = [];
            let m;
            while ((m = titleRe.exec(html)) && titles.length < limit) {
                titles.push({ url: m[1], text: this._clean(m[2]) });
            }
            while ((m = snipRe.exec(html)) && snippets.length < limit) {
                snippets.push(this._clean(m[1]));
            }

            if (titles.length === 0) return null;

            const lines = titles.map((t, i) => {
                const snip = snippets[i];
                const decodedUrl = t.url.replace(/^\/\/duckduckgo\.com\/l\/\?uddg=/, '').split('&rut=')[0];
                const urlClean = decodeURIComponent(decodedUrl || t.url).trim();
                return `${i + 1}. ${t.text}\n   ${snip ? snip + ' ' : ''}(${urlClean})`;
            });

            return 'RESULTADOS DA WEB:\n' + lines.join('\n');
        } catch (e) {
            return null;
        }
    }

    static async _wikipedia(query, limit) {
        try {
            const url = 'https://pt.wikipedia.org/w/api.php?action=query&list=search&srlimit=' + limit +
                '&format=json&srsearch=' + encodeURIComponent(query);
            const res = await fetch(url, {
                headers: { 'User-Agent': 'HostVille-Bot/5.0' },
                signal: AbortSignal.timeout(8000)
            });
            if (!res.ok) return null;
            const data = await res.json();
            const results = data?.query?.search || [];
            if (results.length === 0) return null;

            const lines = results.map((r, i) =>
                `${i + 1}. ${r.title}\n   ${this._clean(r.snippet || '')} (https://pt.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))})`
            );

            return 'RESULTADOS DA WEB:\n' + lines.join('\n');
        } catch (e) {
            return null;
        }
    }
}

module.exports = WebSearch;