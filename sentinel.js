// =====================================================================
// 🛡️ MOTOR AEGIS 8.0: FULL ENV CONFIG & AUTO-PAIRING CLOUD EDITION
// =====================================================================
require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, isJidGroup, fetchLatestBaileysVersion, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs'); 

// ⏱️ RELÓGIO MESTRE ABSOLUTO
const TEMPO_BOOT = Math.floor(Date.now() / 1000);

// 🤫 SILENCIADOR NÍVEL MILITAR 
const consoleLogOriginal = console.log;
const consoleInfoOriginal = console.info;

const filtroSilenciador = (args) => {
    if (typeof args[0] === 'string') {
        const txt = args[0];
        if (txt.includes('Closing session') || 
            txt.includes('Closing open session') || 
            txt.includes('SessionEntry') || 
            txt.includes('prekey bundle') || 
            txt.includes('ephemeralKeyPair') ||
            txt.includes('registrationId')) return true;
    }
    return false;
};

console.log = function (...args) { if (!filtroSilenciador(args)) consoleLogOriginal.apply(console, args); };
console.info = function (...args) { if (!filtroSilenciador(args)) consoleInfoOriginal.apply(console, args); };

process.on('uncaughtException', err => console.error('\n[💀 ERRO FATAL]', err));
process.on('unhandledRejection', err => console.error('\n[💀 REJEIÇÃO]', err));

// =================================================================
// ⚙️ PAINEL DE CONTROLE (VARIÁVEIS DE AMBIENTE)
// =================================================================
const WHITELIST_REMETENTES = process.env.WHITELIST_REMETENTES 
    ? process.env.WHITELIST_REMETENTES.split(',').map(s => s.trim()) 
    : [];

// 📱 NÚMEROS DAS TROPAS VIA ENV (Separados por vírgula ex: 551699...,551699...)
const NUMEROS_SNIPERS = process.env.SNIPER_NUMBERS 
    ? process.env.SNIPER_NUMBERS.split(',').map(s => s.replace(/\D/g, '').trim()) 
    : [];

const NUMEROS_ESPIOES = process.env.SPOTTER_NUMBERS 
    ? process.env.SPOTTER_NUMBERS.split(',').map(s => s.replace(/\D/g, '').trim()) 
    : [];

const GRUPO_DE_ALERTAS = process.env.GRUPO_DE_ALERTAS || ""; 

const ARQUIVO_BLACKLIST = './blacklist_aegis.json';
const ARQUIVO_STATS = './estatisticas_aegis.json'; 
const ultimasAmeacas = new Set(); 
const cacheGrupos = {}; 
const pendingMetadata = {}; 
const travasDeRedundancia = new Set(); 

let cacheBlacklist = [];
let cacheEstatisticas = { total_mensagens_apagadas: 0, total_banimentos: 0, hackers_bloqueados: [], grupos_protegidos: [] };

// =================================================================
// 🛡️ OTIMIZADOR DE DISCO (DEBOUNCE ANTI-EMFILE)
// =================================================================
function criarCredsOtimizado(authOriginal) {
    let timer = null;
    return {
        state: authOriginal.state,
        saveCreds: () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(async () => {
                try {
                    await authOriginal.saveCreds();
                } catch (e) {}
            }, 10000); 
        }
    };
}

// =================================================================
// 📊 SISTEMA DE TELEMETRIA E BANCO DE DADOS
// =================================================================
function carregarBancosDeDadosParaRAM() {
    if (!fs.existsSync(ARQUIVO_BLACKLIST)) fs.writeFileSync(ARQUIVO_BLACKLIST, JSON.stringify([])); 
    cacheBlacklist = JSON.parse(fs.readFileSync(ARQUIVO_BLACKLIST));

    if (!fs.existsSync(ARQUIVO_STATS)) fs.writeFileSync(ARQUIVO_STATS, JSON.stringify(cacheEstatisticas, null, 2));
    cacheEstatisticas = JSON.parse(fs.readFileSync(ARQUIVO_STATS));
}

function registrarEstatistica(acao, numeroInvasor = null, nomeGrupo = null) {
    if (acao === 'MENSAGEM') cacheEstatisticas.total_mensagens_apagadas += 1;
    if (acao === 'BANIMENTO' && numeroInvasor && nomeGrupo) {
        cacheEstatisticas.total_banimentos += 1;
        if (!cacheEstatisticas.hackers_bloqueados.includes(numeroInvasor)) cacheEstatisticas.hackers_bloqueados.push(numeroInvasor);
        if (!cacheEstatisticas.grupos_protegidos.includes(nomeGrupo)) cacheEstatisticas.grupos_protegidos.push(nomeGrupo);
    }
    fs.promises.writeFile(ARQUIVO_STATS, JSON.stringify(cacheEstatisticas, null, 2)).catch(()=>{});
}

function normalizarID(jid) {
    if (!jid) return "";
    let num = String(jid).split('@')[0].split(':')[0].replace(/\D/g, ''); 
    if (num.startsWith('55')) num = num.substring(2); 
    if (num.length === 11 && num[2] === '9') num = num.substring(0, 2) + num.substring(3); 
    return num; 
}

function adicionarNaBlacklist(jid) {
    const idNorm = normalizarID(jid);
    let atualizou = false;

    if (!cacheBlacklist.includes(jid)) { cacheBlacklist.push(jid); atualizou = true; }
    if (idNorm && !cacheBlacklist.includes(idNorm)) { cacheBlacklist.push(idNorm); atualizou = true; }
    
    if (atualizou) {
        fs.promises.writeFile(ARQUIVO_BLACKLIST, JSON.stringify(cacheBlacklist, null, 2)).catch(()=>{});
    }
}

let frotaSnipers = []; 
let frotaEspioes = []; 

// =================================================================
// 🛡️ MOTOR DE FAILOVER
// =================================================================
async function obterMetadataSegura(chatId) {
    for (const sniper of frotaSnipers) {
        if (!sniper) continue;
        try { return await sniper.groupMetadata(chatId); } catch (e) {}
    }
    return null; 
}

// =================================================================
// PASSO 1: FÁBRICA DE SNIPERS (AUTOMATIZADA VIA ENV)
// =================================================================
async function iniciarSniper(indice) {
    const numeroSniper = NUMEROS_SNIPERS[indice - 1] || "";
    console.log(`\n[*] [SNIPER 0${indice}] Verificando credenciais de artilharia (${numeroSniper || 'Sem número na ENV'})...`);
    
    const authSniper = criarCredsOtimizado(await useMultiFileAuthState(`auth_sniper_${indice}`));
    return new Promise((resolve) => conectarSniperNode(indice, numeroSniper, authSniper, resolve));
}

async function conectarSniperNode(indice, numeroSniper, authSniper, resolve) {
    const { version } = await fetchLatestBaileysVersion();
    let codigoSolicitado = false;
    
    const sockSniper = makeWASocket({
        version, auth: authSniper.state, printQRInTerminal: false, logger: pino({ level: 'silent' }), browser: ['Mac OS', 'Chrome', '121.0.0.0'], markOnlineOnConnect: true
    });
    
    frotaSnipers[indice - 1] = sockSniper; 
    sockSniper.ev.on('creds.update', authSniper.saveCreds);
    
    sockSniper.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        // Se não estiver registrado, gera o código automaticamente usando a ENV e exibe nos logs do EasyPanel!
        if ((qr || !sockSniper.authState.creds.registered) && numeroSniper && !codigoSolicitado && connection !== 'open') {
            codigoSolicitado = true;
            try { 
                const code = await sockSniper.requestPairingCode(numeroSniper); 
                console.log(`\n========================================`);
                console.log(`[🔑] CÓDIGO DE PAREAMENTO DO SNIPER 0${indice}: ${code}`);
                console.log(`========================================\n`);
            } catch (err) {
                codigoSolicitado = false; // Permite tentar novamente se falhar
            }
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) {
                conectarSniperNode(indice, numeroSniper, authSniper, resolve); 
            }
        }
        if (connection === 'open') {
            console.log(`[✅ SNIPER 0${indice}] Conectado, Armado e em Posição!`); 
            resolve(); 
        }
    });

    sockSniper.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        
        for (const msg of messages) {
            if (!msg.message) continue; 
            
            const msgTime = Number(msg.messageTimestamp || 0);
            if (msgTime > 0 && msgTime < TEMPO_BOOT) continue;
            
            let texto = msg.message.conversation || 
                        msg.message.extendedTextMessage?.text || 
                        msg.message.ephemeralMessage?.message?.extendedTextMessage?.text || 
                        msg.message.ephemeralMessage?.message?.conversation || 
                        msg.message.imageMessage?.caption ||
                        "";
                        
            texto = texto.trim().toLowerCase();
            
            if (texto === '!idgrupo' || texto === '!ping') {
                const senderId = msg.key.participant || msg.key.remoteJid;
                const isMe = msg.key.fromMe;
                
                const listaSegura = WHITELIST_REMETENTES.map(normalizarID);
                const alvoLimpo = normalizarID(senderId);
                const isWhitelisted = listaSegura.includes(alvoLimpo);

                if (isMe || isWhitelisted) {
                    const hashCmd = msg.key.id;
                    if (travasDeRedundancia.has(hashCmd)) continue; 
                    travasDeRedundancia.add(hashCmd);
                    setTimeout(() => travasDeRedundancia.delete(hashCmd), 60000);

                    const chatId = msg.key.remoteJid;
                    
                    if (texto === '!ping') {
                        await sockSniper.sendMessage(chatId, { text: `🏓 *Pong!* A escuta do Sniper 0${indice} está limpa e operante.` });
                    } else if (texto === '!idgrupo') {
                        await sockSniper.sendMessage(chatId, { text: `📍 *ANTI-HACKER BRABO: ID DO GRUPO DE ALERTA:*\n\n\`${chatId}\`` });
                        console.log(`\n[📡 COMANDO C2] ID do Grupo solicitado com sucesso!`);
                    }
                }
            }
        }
    });

    sockSniper.ev.on('group-participants.update', async (evento) => {
        if (evento.action === 'add') {
            for (let novato of evento.participants) {
                if (typeof novato === 'object' && novato !== null) novato = novato.id || novato.jid || "";
                if (!novato) continue;
                novato = String(novato); 

                const hashEntrada = `${evento.id}-${novato}`;
                if (travasDeRedundancia.has(hashEntrada)) continue; 

                const idNorm = normalizarID(novato);
                const numPuro = novato.split('@')[0].split(':')[0]; 

                const ehInimigo = cacheBlacklist.some(b => b === novato || b.includes(numPuro) || normalizarID(b) === idNorm);

                if (ehInimigo) {
                    travasDeRedundancia.add(hashEntrada);
                    setTimeout(() => travasDeRedundancia.delete(hashEntrada), 30000);

                    console.log(`\n[🚪 CATRACA DE FERRO] Invasor da Blacklist na porta: ${numPuro}`);
                    
                    let nomeGrupo = evento.id;
                    try {
                        const metadata = await obterMetadataSegura(evento.id);
                        if (metadata) nomeGrupo = metadata.subject || evento.id;
                    } catch(e){}

                    setTimeout(async () => {
                        let ejetado = false;
                        for (const sniper of frotaSnipers) {
                            if (!sniper) continue;
                            try {
                                await sniper.groupParticipantsUpdate(evento.id, [novato], "remove");
                                ejetado = true;
                                console.log(`[✅ EJETADO] Invasor barrado pelo Sniper 0${frotaSnipers.indexOf(sniper) + 1}.`);
                                registrarEstatistica('BANIMENTO', numPuro, nomeGrupo);
                                break; 
                            } catch (err) {}
                        }
                    }, 1500); 
                } 
            }
        }
    });
}

// =================================================================
// PASSO 2: FÁBRICA DE ESPIÕES (AUTOMATIZADA VIA ENV)
// =================================================================
async function iniciarEspiao(indice) {
    const numeroSpotter = NUMEROS_ESPIOES[indice - 1] || "";
    console.log(`\n[*] [ESPIÃO 0${indice}] Verificando credenciais (${numeroSpotter || 'Sem número na ENV'})...`);
    
    const authSpotter = criarCredsOtimizado(await useMultiFileAuthState(`auth_spotter_${indice}`));
    return new Promise((resolve) => conectarEspiaoNode(indice, numeroSpotter, authSpotter, resolve));
}

async function conectarEspiaoNode(indice, numeroSpotter, authSpotter, resolve) {
    const { version } = await fetchLatestBaileysVersion();
    let codigoSolicitado = false;
    
    const sockEspiao = makeWASocket({
        version, auth: authSpotter.state, printQRInTerminal: false, logger: pino({ level: 'silent' }), browser: ['Mac OS', 'Chrome', '121.0.0.0'], markOnlineOnConnect: true
    });
    
    frotaEspioes[indice - 1] = sockEspiao; 
    sockEspiao.ev.on('creds.update', authSpotter.saveCreds);
    
    sockEspiao.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if ((qr || !sockEspiao.authState.creds.registered) && numeroSpotter && !codigoSolicitado && connection !== 'open') {
            codigoSolicitado = true;
            try { 
                const code = await sockEspiao.requestPairingCode(numeroSpotter); 
                console.log(`\n========================================`);
                console.log(`[🔑] CÓDIGO DE PAREAMENTO DO ESPIÃO 0${indice}: ${code}`);
                console.log(`========================================\n`);
            } catch (err) {
                codigoSolicitado = false;
            }
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) {
                conectarEspiaoNode(indice, numeroSpotter, authSpotter, resolve); 
            }
        }
        if (connection === 'open') {
            console.log(`[✅ ESPIÃO 0${indice}] Infiltrado e Operacional!`);
            resolve();
        }
    });

    sockEspiao.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return; 

        for (const msg of messages) {
            if (!msg.message || !msg.key || msg.key.fromMe) continue; 
            
            const msgTime = Number(msg.messageTimestamp || 0);
            if (msgTime > 0 && msgTime < TEMPO_BOOT) continue; 

            if (ultimasAmeacas.has(msg.key.id)) continue;
            ultimasAmeacas.add(msg.key.id);
            setTimeout(() => ultimasAmeacas.delete(msg.key.id), 10000);

            const chavesInternas = Object.keys(msg.message || {});
            const chavesVisiveis = chavesInternas.filter(k => 
                k !== 'senderKeyDistributionMessage' && 
                k !== 'messageContextInfo' && 
                k !== 'protocolMessage'
            );

            if (chavesVisiveis.length === 0) continue; 

            const chatId = msg.key.remoteJid;
            const senderId = msg.key.participant || msg.key.remoteJid;
            if (senderId === chatId) continue;
            
            const numInvasorCru = senderId.split('@')[0].split(':')[0];

            if (
                senderId.includes('@broadcast') || 
                senderId.includes('@newsletter') || 
                senderId.includes('@lid') || 
                senderId === '0@s.whatsapp.net' || 
                numInvasorCru.length >= 15 
            ) continue;

            if (isJidGroup(chatId)) {
                const idAlvoNorm = normalizarID(senderId);
                const whitelist = WHITELIST_REMETENTES.map(normalizarID);
                const idsSnipers = frotaSnipers.map(s => normalizarID(s?.user?.id));
                const idsFrota = frotaEspioes.map(espiao => normalizarID(espiao?.user?.id));
                const listaSegura = [...whitelist, ...idsSnipers, ...idsFrota].filter(Boolean);

                if (listaSegura.includes(idAlvoNorm)) continue; 

                let isAdmin = false;
                let nomeGrupo = chatId;
                const agora = Date.now();

                if (!cacheGrupos[chatId] || agora - cacheGrupos[chatId].tempo > 60000) {
                    if (!pendingMetadata[chatId]) {
                        pendingMetadata[chatId] = obterMetadataSegura(chatId) 
                            .then(metadata => {
                                if (metadata) cacheGrupos[chatId] = { dados: metadata, tempo: Date.now() };
                                delete pendingMetadata[chatId]; 
                            })
                            .catch(e => { delete pendingMetadata[chatId]; });
                    }
                    await pendingMetadata[chatId]; 
                }

                if (cacheGrupos[chatId]) {
                    nomeGrupo = cacheGrupos[chatId].dados.subject || chatId;
                    const participante = cacheGrupos[chatId].dados.participants.find(p => p.id === senderId || normalizarID(p.id) === idAlvoNorm);
                    if (participante && (participante.admin === 'admin' || participante.admin === 'superadmin')) {
                        isAdmin = true;
                    }
                }

                if (isAdmin) continue; 
                
                console.log(`\n[💀 ALERTA MÁXIMO] Invasão em andamento...`);
                
                let msgApagada = false;
                let invasorBanido = false;

                for (const sniper of frotaSnipers) {
                    if (!sniper) continue;
                    
                    if (!msgApagada) {
                        try {
                            await sniper.sendMessage(chatId, { delete: { remoteJid: chatId, id: msg.key.id, participant: senderId } });
                            msgApagada = true;
                        } catch (e) {}
                    }
                    if (!invasorBanido) {
                        try {
                            await sniper.groupParticipantsUpdate(chatId, [senderId], "remove");
                            invasorBanido = true;
                        } catch (e) {}
                    }
                    if (msgApagada && invasorBanido) break; 
                }

                if (msgApagada || invasorBanido) {
                    registrarEstatistica('MENSAGEM');
                    adicionarNaBlacklist(senderId);

                    let banimentos = 0;
                    const gruposVerificados = new Set();

                    for (const sniper of frotaSnipers) {
                        if (!sniper) continue;
                        try {
                            const todosOsGrupos = await sniper.groupFetchAllParticipating();
                            for (const idGrupo in todosOsGrupos) {
                                if (gruposVerificados.has(idGrupo)) continue; 
                                
                                const grupoAlvo = todosOsGrupos[idGrupo];
                                const alvoEscondido = grupoAlvo.participants.find(p => p.id === senderId || normalizarID(p.id) === idAlvoNorm);
                                
                                if (alvoEscondido) {
                                    try {
                                        await sniper.groupParticipantsUpdate(idGrupo, [alvoEscondido.id], "remove");
                                        banimentos++;
                                        gruposVerificados.add(idGrupo);
                                        const nomeGrupoAfetado = grupoAlvo.subject || idGrupo;
                                        registrarEstatistica('BANIMENTO', idAlvoNorm, nomeGrupoAfetado);
                                    } catch(e){} 
                                } else {
                                    gruposVerificados.add(idGrupo); 
                                }
                            }
                        } catch(e) {}
                    }

                    console.log(`[🌍 ORDEM 66 CONCLUÍDA] Invasor pulverizado de ${banimentos} grupos!`);

                    if (GRUPO_DE_ALERTAS && GRUPO_DE_ALERTAS.includes('@g.us')) {
                        const alertaAtaque = `*🚨 INTERCEPTAÇÃO ANTI-HACKER BRABO*\n\n` +
                                             `*📍 Grupo Atacado:* ${nomeGrupo}\n` +
                                             `*👤 Invasor:* wa.me/${numInvasorCru}\n` +
                                             `*⚙️ Status:* Neutralizado & Expurgado de ${banimentos} grupos.\n\n` +
                                             `*🛡️ Anti-Hacker Brabo*`;
                        
                        for (const sniper of frotaSnipers) {
                            if (!sniper) continue;
                            try {
                                await sniper.sendMessage(GRUPO_DE_ALERTAS, { text: alertaAtaque });
                                break; 
                            } catch (err) {}
                        }
                    }
                }
            }
        }
    });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function iniciarOperacaoAegis() {
    console.clear(); 

    const corBranca = '\x1b[1;37m';       
    const corLaranja = '\x1b[38;5;208m';  
    const corVerde = '\x1b[1;32m';        
    const corVermelha = '\x1b[1;31m';     
    const corCinza = '\x1b[90m';          
    const reset = '\x1b[0m';              

    console.log(corBranca + `
     █████╗ ███╗   ██╗████████╗██╗       ██╗  ██╗ █████╗  ██████╗ ██╗  ██╗███████╗██████╗ 
    ██╔══██╗████╗  ██║╚══██╔══╝██║       ██║  ██║██╔══██╗██╔════╝ ██║ ██╔╝██╔════╝██╔══██╗
    ███████║██╔██╗ ██║   ██║   ██║ █████╗███████║███████║██║      █████╔╝ █████╗  ██████╔╝
    ██╔══██║██║╚██╗██║   ██║   ██║ ╚════╝██╔══██║██╔══██║██║      ██╔═██╗ ██╔══╝  ██╔══██╗
    ██║  ██║██║ ╚████║   ██║   ██║       ██║  ██║██║  ██║╚██████╗ ██║  ██╗███████╗██║  ██║
    ╚═╝  ╚═╝╚═╝  ╚═══╝   ╚═╝   ╚═╝       ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝` + 
    corLaranja + `
                    ██████╗ ██████╗  █████╗ ██████╗  ██████╗ 
                    ██╔══██╗██╔══██╗██╔══██╗██╔══██╗██╔═══██╗
                    ██████╦╝██████╔╝███████║██████╦╝██║   ██║
                    ██╔══██╗██╔══██╗██╔══██║██╔══██╗██║   ██║
                    ██████╦╝██║  ██║██║  ██║██████╦╝╚██████╔╝
                    ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝  ╚═════╝ 
    ` + reset);

    console.log(corLaranja + `[ ⚠ ] CARREGANDO MOTOR DE DEFESA (AEGIS v8.0 FULL ENV)` + reset + `\n`);
    
    await sleep(600);
    console.log(corBranca + `[BOOT] Inicializando Kernel Tático... ` + corLaranja + `[OK]` + reset);
    await sleep(400);
    
    carregarBancosDeDadosParaRAM();
    
    console.log(corBranca + `[BOOT] Injetando Bancos de Dados na Memória RAM (Zero Disk I/O)... ` + corLaranja + `[OK]` + reset);
    await sleep(800);
    console.log(corBranca + `[BOOT] Configurando Sistema Ativo-Passivo (Standby)... ` + corLaranja + `[OK]` + reset);
    await sleep(300);
    console.log(corBranca + `[BOOT] Injetando Debounce e Configurações de Nuvem... ` + corLaranja + `[OK]` + reset);
    await sleep(900);
    console.log(corBranca + `[BOOT] Conectando Artilharia Pesada (WebSockets)...\n` + reset);
    await sleep(1000);

    for (let i = 1; i <= NUMEROS_SNIPERS.length; i++) {
        await iniciarSniper(i);
    }
    
    for (let i = 1; i <= NUMEROS_ESPIOES.length; i++) {
        await iniciarEspiao(i);
    }

    console.log(corBranca + `[BOOT] Aguardando calibração do rádio (5 segundos)...` + reset);
    await sleep(5000);

    if (GRUPO_DE_ALERTAS && GRUPO_DE_ALERTAS.includes('@g.us')) {
        const msgBoot = `*🟢 SISTEMA ANTI-HACKER BRABO ONLINE*\n\n_Centro de Comando localizado e conectado com sucesso (Full ENV)._ 🛡️`;
        
        (async () => {
            for (const sniper of frotaSnipers) {
                if (!sniper) continue;
                try {
                    await Promise.race([
                        sniper.sendMessage(GRUPO_DE_ALERTAS, { text: msgBoot }),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 6000))
                    ]);
                    console.log(`\n` + corVerde + `[ 📡 C2 ONLINE ] Mensagem de inicialização enviada ao painel de alertas.` + reset);
                    break; 
                } catch (err) {}
            }
        })();
    }

    console.log(corCinza + `\n=================================================================` + reset);
    console.log(corVerde + `[ 🟢 STATUS ] REDE DE SEGURANÇA MÁXIMA ONLINE.` + reset);
    console.log(corLaranja + `[ 🔇 RADAR  ] RAM Cache, Ordem 66, Alertas C2 e ENV Ativados.` + reset);
    console.log(corVermelha + `[ 💀 AMEAÇA ] Zero tolerância. O primeiro erro será o último.` + reset);
    console.log(corCinza + `=================================================================\n` + reset);
}

iniciarOperacaoAegis();