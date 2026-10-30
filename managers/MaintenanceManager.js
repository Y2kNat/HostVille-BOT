const fs = require('fs');
const path = require('path');
const { EmbedBuilder, Colors } = require('discord.js');

const FILE = path.join(__dirname, '..', 'data', 'maintenance.json');

const DEFAULT = {
    enabled: false,
    motivo: '',
    updatedBy: '',
    updatedAt: null
};

class MaintenanceManager {

    static getData() {
        try {
            const raw = fs.readFileSync(FILE, 'utf-8');
            return { ...DEFAULT, ...JSON.parse(raw) };
        } catch {
            return { ...DEFAULT };
        }
    }

    /**
     * A manutenção é a PRIMEIRA coisa que o messageCreate olha, e é
     * checked a cada mensagem. Por isso o arquivo local e não o banco: um
     * toggle de manutenção que espera uma consulta de rede para valer é um
     * botão que não funciona na hora que ele é apertado.
     */
    static isEnabled() {
        if (this.getData().enabled === true) return true;
        // O botão de pausa de emergência desliga a manutenção sem passar por
        // aqui, porque escreve a chave direto. A chave é quem manda; o
        // arquivo é quem sobrevive a banco fora. Basta um dos dois estar
        // ligado para a manutenção valer.
        try {
            const Features = require('./FeatureRegistry');
            if (typeof Features.ligadoSync === 'function' && Features.ligadoSync('manutencao')) return true;
        } catch (e) { /* registry indisponível: manda o arquivo */ }
        return false;
    }

    static setData(data) {
        const d = { ...DEFAULT, ...data };
        fs.writeFileSync(FILE, JSON.stringify(d, null, 2), 'utf-8');

        // A chave `manutencao` do FeatureRegistry é o MESMO estado, visto pelo
        // painel. Sem esta escrita de volta, o /adm mostrava um 🟢 que não
        // mandava em nada: nada lia a chave, e o único caminho era o
        // /maintenance. Uma tela que mostra o estado errado é pior do que
        // não ter a chave.
        try {
            const Features = require('./FeatureRegistry');
            if (typeof Features.ligadoSync === 'function') {
                if (Features.ligadoSync('manutencao') !== (d.enabled === true)) {
                    Features.set('manutencao', 'global', d.enabled === true,
                        d.updatedBy ? `manutenção (${d.updatedBy})` : 'manutenção').catch(() => {});
                }
            }
        } catch (e) { /* registry indisponível: o arquivo manda, e está certo */ }

        return this.getData();
    }

    static buildEmbed() {
        const d = this.getData();
        const who = d.updatedBy ? `<@${d.updatedBy}>` : 'staff';

        return new EmbedBuilder()
            .setColor(Colors.Orange)
            .setTitle('🔧 Estou em manutenção')
            .setDescription(d.motivo
                ? `**Motivo:** ${d.motivo}`
                : '**Motivo:** Estou passando por uma manutenção, volto já já!')
            .addFields(
                { name: '⏳ Status', value: 'Nenhuma ação será processada enquanto a manutenção durar.', inline: false },
                { name: '🔧 Iniciada por', value: who, inline: false }
            )
            .setTimestamp(d.updatedAt || Date.now())
            .setFooter({ text: 'Tente novamente mais tarde!' });
    }
}

module.exports = MaintenanceManager;