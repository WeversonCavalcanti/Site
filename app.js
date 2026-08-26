// Configurações do Discord (Usando o ID do Apolo)
const DISCORD_CLIENT_ID = '1143208423505277068';
// URL limpa sem parâmetros para o Discord conseguir redirecionar de volta
const REDIRECT_URI = encodeURIComponent(window.location.origin + window.location.pathname);

// Variáveis Globais
let myProfile = { username: 'Convidado', avatar: 'https://cdn.discordapp.com/embed/avatars/0.png' };
let hostIdToConnect = null;
let connections = [];
let roomUsers = []; 
const peer = new Peer();

// Elementos da UI
const loginOverlay = document.getElementById('login-overlay');
const mainContainer = document.getElementById('main-container');
const video = document.getElementById('video');
const startBtn = document.getElementById('start-btn');
const broadcasterUi = document.getElementById('broadcaster-ui');
const shareLink = document.getElementById('share-link');
const userList = document.getElementById('user-list');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const viewerCountSpan = document.getElementById('viewer-count');

// 1. GERENCIAMENTO DE LOGIN
function checkAuth() {
    // Verifica se tem link de convite na URL e salva para não perder no redirecionamento do Discord
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('watch')) {
        localStorage.setItem('savedRoomId', urlParams.get('watch'));
    }
    
    // Verifica se acabou de voltar do login do Discord
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = fragment.get('access_token');

    if (accessToken) {
        // Limpa a URL para ficar bonita
        window.history.replaceState(null, null, window.location.pathname);
        fetchDiscordProfile(accessToken);
    } else {
        // Mostra a tela de login
        loginOverlay.style.display = 'flex';
    }

    // Botão de login do Discord
    document.getElementById('login-discord-btn').addEventListener('click', () => {
        const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${REDIRECT_URI}&response_type=token&scope=identify`;
        window.location.href = discordAuthUrl;
    });
}

async function fetchDiscordProfile(token) {
    try {
        const response = await fetch('https://discord.com/api/users/@me', {
            headers: { authorization: `Bearer ${token}` }
        });
        const userData = await response.json();
        
        myProfile.username = userData.global_name || userData.username;
        myProfile.avatar = userData.avatar ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png';
        
        // Login com sucesso! Libera a interface principal
        loginOverlay.style.display = 'none';
        mainContainer.style.display = 'flex';
        
        // Verifica se estava tentando entrar em uma sala antes de logar
        hostIdToConnect = localStorage.getItem('savedRoomId');
        
        if (hostIdToConnect) {
            initViewer();
        } else {
            initHost();
        }
    } catch (error) {
        console.error("Erro no login:", error);
        alert("Falha ao autenticar com o Discord.");
        loginOverlay.style.display = 'flex';
    }
}

// 2. FUNÇÕES DE INTERFACE (Chat e Lista)
function addChatMessage(user, text) {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message';
    msgDiv.innerHTML = `
        <div class="header">
            <img src="${user.avatar}" alt="Avatar">
            <span class="username">${user.username}</span>
        </div>
        <div class="text">${text}</div>
    `;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function renderUserList() {
    userList.innerHTML = '';
    roomUsers.forEach(user => {
        const li = document.createElement('li');
        li.className = 'user-item';
        li.innerHTML = `
            <img src="${user.avatar}" class="user-avatar" alt="Avatar">
            <span class="user-name">${user.username} ${user.isHost ? '(Host)' : ''}</span>
            <div class="user-status"></div>
        `;
        userList.appendChild(li);
    });
    viewerCountSpan.textContent = roomUsers.length > 0 ? roomUsers.length - 1 : 0; // Exclui o Host da contagem
}

// 3. MODO VISUALIZADOR (Amigo assistindo)
function initViewer() {
    let dataConn;
    broadcasterUi.style.display = 'none';
    
    // Adiciona o próprio perfil na lista local (será sobrescrito pelo Host para sincronia)
    roomUsers = [{ ...myProfile, isHost: false }];
    renderUserList();

    peer.on('open', () => {
        dataConn = peer.connect(hostIdToConnect);
        
        dataConn.on('open', () => {
            // Assim que conecta, manda os dados do Discord para o Host
            dataConn.send({ type: 'join', profile: myProfile });
            connections.push(dataConn);
        });

        dataConn.on('data', (data) => {
            if (data.type === 'chat') {
                addChatMessage(data.profile, data.message);
            } else if (data.type === 'room_update') {
                // Host atualizou a lista de quem tá na sala
                roomUsers = data.users;
                renderUserList();
            }
        });
    });

    peer.on('call', (call) => {
        call.answer();
        call.on('stream', (remoteStream) => {
            video.srcObject = remoteStream;
        });
    });

    sendBtn.addEventListener('click', () => {
        const msg = chatInput.value;
        if (msg && dataConn && dataConn.open) {
            dataConn.send({ type: 'chat', profile: myProfile, message: msg });
            addChatMessage(myProfile, msg);
            chatInput.value = '';
        }
    });
}

// 4. MODO TRANSMISSOR (Você transmitindo)
function initHost() {
    broadcasterUi.style.display = 'block';
    let myStream;
    
    // O Host é o primeiro da lista
    roomUsers = [{ ...myProfile, isHost: true }];
    renderUserList();
    
    // Limpa a sala salva caso você decida ser o host depois de ser viewer
    localStorage.removeItem('savedRoomId');
    
    startBtn.addEventListener('click', async () => {
        try {
            myStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            video.srcObject = myStream;
            video.muted = true;
            
            const link = `${window.location.origin}${window.location.pathname}?watch=${peer.id}`;
            shareLink.href = link;
            shareLink.textContent = "Copiar Link de Convite";
            shareLink.addEventListener('click', (e) => {
                e.preventDefault();
                navigator.clipboard.writeText(link);
                alert("Link copiado! Mande no Discord.");
            });
            
            broadcasterUi.style.display = 'none';
        } catch (err) {
            console.error("Erro ao capturar tela:", err);
        }
    });

    peer.on('connection', (conn) => {
        connections.push(conn);

        conn.on('data', (data) => {
            if (data.type === 'join') {
                // Alguém entrou e mandou a foto do Discord!
                const newUser = { ...data.profile, peerId: conn.peer, isHost: false };
                roomUsers.push(newUser);
                renderUserList();
                addChatMessage({ username: 'Sistema', avatar: 'https://cdn.discordapp.com/embed/avatars/3.png' }, `${newUser.username} entrou na sala!🍿`);
                
                // Manda a lista atualizada pra todo mundo
                broadcastData({ type: 'room_update', users: roomUsers });
                
                // Se a live já começou, liga pra quem acabou de entrar
                if (myStream) {
                    peer.call(conn.peer, myStream);
                }
            }
            else if (data.type === 'chat') {
                // Repassa o chat para os outros
                connections.forEach(c => {
                    if (c.peer !== conn.peer && c.open) c.send(data);
                });
                addChatMessage(data.profile, data.message);
            }
        });

        conn.on('close', () => {
            connections = connections.filter(c => c.peer !== conn.peer);
            const userLeft = roomUsers.find(u => u.peerId === conn.peer);
            roomUsers = roomUsers.filter(u => u.peerId !== conn.peer);
            renderUserList();
            
            if(userLeft) {
                addChatMessage({ username: 'Sistema', avatar: 'https://cdn.discordapp.com/embed/avatars/3.png' }, `${userLeft.username} saiu da sala.`);
            }
            broadcastData({ type: 'room_update', users: roomUsers });
        });
    });

    sendBtn.addEventListener('click', () => {
        const msg = chatInput.value;
        if (msg) {
            broadcastData({ type: 'chat', profile: myProfile, message: msg });
            addChatMessage(myProfile, msg);
            chatInput.value = '';
        }
    });
    
    // Função auxiliar para retransmitir dados do Host para todos
    function broadcastData(data) {
        connections.forEach(conn => {
            if (conn.open) conn.send(data);
        });
    }
}

// Inicializa checando se já está logado
checkAuth();