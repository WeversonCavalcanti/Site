// Configurações do Discord
const DISCORD_CLIENT_ID = '887831186188148747';
const REDIRECT_URI = encodeURIComponent(window.location.origin + window.location.pathname);

// Variáveis Globais
let myProfile = { username: 'Convidado', avatar: 'https://cdn.discordapp.com/embed/avatars/0.png' };
let hostIdToConnect = null;
let connections = [];
let roomUsers = []; 
let peer; 

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
const leaveBtn = document.getElementById('leave-btn');
const stopStreamBtn = document.getElementById('stop-stream-btn');

// Perfil do Bot de Sistema
const sysProfile = { username: 'Sistema', avatar: 'https://cdn.discordapp.com/embed/avatars/3.png' };

// 1. GERENCIAMENTO DE LOGIN E SESSÃO
function checkAuth() {
    const urlParams = new URLSearchParams(window.location.search);
    const watchId = urlParams.get('watch');
    
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const urlToken = fragment.get('access_token');

    if (watchId) {
        localStorage.setItem('savedRoomId', watchId);
    } else if (!urlToken) {
        localStorage.removeItem('savedRoomId');
    }

    if (urlToken) {
        localStorage.setItem('discordToken', urlToken);
        window.history.replaceState(null, null, window.location.pathname);
        fetchDiscordProfile(urlToken);
    } else {
        const savedToken = localStorage.getItem('discordToken');
        if (savedToken) {
            fetchDiscordProfile(savedToken);
        } else {
            loginOverlay.style.display = 'flex';
        }
    }

    document.getElementById('login-discord-btn').onclick = () => {
        const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${REDIRECT_URI}&response_type=token&scope=identify`;
        window.location.href = discordAuthUrl;
    };
}

async function fetchDiscordProfile(token) {
    try {
        const response = await fetch('https://discord.com/api/users/@me', {
            headers: { authorization: `Bearer ${token}` }
        });
        
        if (!response.ok) throw new Error("Token expirado");
        
        const userData = await response.json();
        
        myProfile.username = userData.global_name || userData.username;
        myProfile.avatar = userData.avatar ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png';
        
        loginOverlay.style.display = 'none';
        mainContainer.style.display = 'flex';
        
        hostIdToConnect = localStorage.getItem('savedRoomId');
        
        if (hostIdToConnect) {
            initViewer();
        } else {
            initHost();
        }
    } catch (error) {
        console.error("Erro no login automático:", error);
        localStorage.removeItem('discordToken');
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
    viewerCountSpan.textContent = roomUsers.length > 0 ? roomUsers.length - 1 : 0;
}

// 3. MODO VISUALIZADOR (Amigo assistindo)
function initViewer() {
    broadcasterUi.style.display = 'none';
    roomUsers = [{ ...myProfile, isHost: false }];
    renderUserList();

    peer = new Peer();
    let dataConn;

    peer.on('open', () => {
        dataConn = peer.connect(hostIdToConnect);
        
        dataConn.on('open', () => {
            dataConn.send({ type: 'join', profile: myProfile });
            connections.push(dataConn);
        });

        dataConn.on('data', (data) => {
            if (data.type === 'chat') {
                addChatMessage(data.profile, data.message);
            } else if (data.type === 'room_update') {
                roomUsers = data.users;
                renderUserList();
            }
        });
    });

    peer.on('call', (call) => {
        call.answer();
        call.on('stream', (remoteStream) => {
            video.srcObject = remoteStream;
            video.muted = false; // Desmuta para a pessoa escutar a live!
        });
    });

    sendBtn.onclick = () => {
        const msg = chatInput.value;
        if (msg && dataConn && dataConn.open) {
            dataConn.send({ type: 'chat', profile: myProfile, message: msg });
            addChatMessage(myProfile, msg);
            chatInput.value = '';
        }
    };
}

// 4. MODO TRANSMISSOR (Você transmitindo)
function initHost() {
    broadcasterUi.style.display = 'block';
    let myStream;
    
    roomUsers = [{ ...myProfile, isHost: true }];
    renderUserList();
    localStorage.removeItem('savedRoomId');

    peer = new Peer();

    startBtn.onclick = async () => {
        if (!peer.id) {
            alert("Aguarde 2 segundinhos, o servidor de salas ainda está carregando seu ID...");
            return;
        }

        const qualityBox = document.getElementById('quality-select');
        let videoQuality = true;

        if (qualityBox) {
            if (qualityBox.value === '1080') {
                videoQuality = { width: 1920, height: 1080, frameRate: 60 };
            } else {
                videoQuality = { width: 1280, height: 720, frameRate: 30 };
            }
        }

        try {
            myStream = await navigator.mediaDevices.getDisplayMedia({ 
                video: videoQuality, 
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false 
                } 
            });
            
            video.srcObject = myStream;
            video.muted = true; 
            
            const link = `${window.location.origin}${window.location.pathname}?watch=${peer.id}`;
            shareLink.href = link;
            shareLink.textContent = "Copiar Link de Convite";
            
            shareLink.onclick = async (e) => {
                e.preventDefault();
                try {
                    await navigator.clipboard.writeText(link);
                    shareLink.textContent = "Link Copiado! ✅";
                    alert("Link copiado para a área de transferência!");
                } catch (err) {
                    prompt("Copie o link da sala (Ctrl+C):", link);
                }
            };
            
            // Esconde a interface de começar e mostra o botão de parar
            broadcasterUi.style.display = 'none';
            stopStreamBtn.style.display = 'inline-block';

            // OTIMIZAÇÃO: Liga a câmera/tela para todo mundo que JÁ ESTÁ na sala
            connections.forEach(conn => {
                if (conn.open) {
                    peer.call(conn.peer, myStream);
                }
            });

        } catch (err) {
            console.error("Erro ao capturar tela:", err);
        }
    };

    // Função de PARAR TRANSMISSÃO
    stopStreamBtn.onclick = () => {
        if (myStream) {
            myStream.getTracks().forEach(track => track.stop());
            myStream = null;
        }
        video.srcObject = null;
        
        // Troca os botões de volta
        stopStreamBtn.style.display = 'none';
        broadcasterUi.style.display = 'block';

        // Avisa no chat
        const stopMsg = "A transmissão foi pausada pelo Host. ⏸️";
        addChatMessage(sysProfile, stopMsg);
        broadcastData({ type: 'chat', profile: sysProfile, message: stopMsg });
    };

    peer.on('connection', (conn) => {
        connections.push(conn);

        conn.on('data', (data) => {
            if (data.type === 'join') {
                const newUser = { ...data.profile, peerId: conn.peer, isHost: false };
                roomUsers.push(newUser);
                renderUserList();
                
                const joinMsg = `${newUser.username} entrou na sala! 🍿`;
                addChatMessage(sysProfile, joinMsg);
                broadcastData({ type: 'chat', profile: sysProfile, message: joinMsg });
                
                broadcastData({ type: 'room_update', users: roomUsers });
                
                if (myStream) {
                    peer.call(conn.peer, myStream);
                }
            }
            else if (data.type === 'chat') {
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
                const leaveMsg = `${userLeft.username} saiu da sala. 👋`;
                addChatMessage(sysProfile, leaveMsg);
                broadcastData({ type: 'chat', profile: sysProfile, message: leaveMsg });
            }
            broadcastData({ type: 'room_update', users: roomUsers });
        });
    });

    sendBtn.onclick = () => {
        const msg = chatInput.value;
        if (msg) {
            broadcastData({ type: 'chat', profile: myProfile, message: msg });
            addChatMessage(myProfile, msg);
            chatInput.value = '';
        }
    };
    
    function broadcastData(data) {
        connections.forEach(conn => {
            if (conn.open) conn.send(data);
        });
    }
}

// 5. EVENTOS GERAIS DA PÁGINA (OTIMIZAÇÕES)
chatInput.addEventListener('keypress', function (e) {
    if (e.key === 'Enter') {
        e.preventDefault(); 
        sendBtn.click(); 
    }
});

// Lógica de SAIR DA SALA
leaveBtn.onclick = () => {
    if(confirm("Deseja mesmo sair da sala?")) {
        localStorage.removeItem('savedRoomId'); // Esquece a sala salva
        if (peer) peer.destroy(); // Isso avisa imediatamente pro Host que a conexão caiu
        
        // Recarrega a página na URL raiz, o que vai fazer ele voltar pro modo Host ou Tela de Login
        window.location.href = window.location.origin + window.location.pathname;
    }
};

// Inicia o fluxo
checkAuth();
