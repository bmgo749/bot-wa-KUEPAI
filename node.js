const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const { Boom } = require('@hapi/boom');

// Inisialisasi auth state
const startBot = async () => {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_state');
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true
    });

    const botNumber = '6283893663566@s.whatsapp.net';

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error = Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed due to ', lastDisconnect.error, ', reconnecting ', shouldReconnect);
            if (shouldReconnect) {
                startBot();
            }
        } else if (connection === 'open') {
            console.log('Connected');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Map untuk menyimpan status AFK pengguna
    const afkStatusMap = new Map();
    // Map untuk menyimpan pesan yang dikirim
    const messageMap = new Map();

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg || !msg.key || !msg.message) {
            console.log('Invalid message structure:', msg);
            return;
        }

        if (!msg.message) return;

        const from = msg.key.remoteJid;
        const sender = msg.key.participant || from;

        // Simpan pesan yang diterima ke messageMap
        if (!messageMap.has(from)) {
            messageMap.set(from, []);
        }

        const messagesForChat = messageMap.get(from);
        if (messagesForChat) {
            messagesForChat.push(msg.key);
        }
            
        if (msg.message.conversation) {
            const message = msg.message.conversation.toLowerCase().trim();
            console.log('Received message:', message);

            if (message.startsWith("pai~afk")) {
                let afkStatus = afkStatusMap.get(from) || false;
                const contactName = msg.pushName || 'Unknown Contact';

                if (afkStatus) {
                    await sock.sendMessage(from, { text: `_${contactName}_*, Kamu Sudah Dalam Mode AFK 💤 Ketik pai~stop-afk Untuk Menyudahi AFK dan Melanjutkan Aktivitas Lainnya! ⏱️*` });
                } else {
                    const parts = message.split(' ');
                    const reason = parts.slice(1).join(' ').trim();
                    const afkReason = reason.length > 0 ? reason : 'Tidak Ada';

                    afkStatus = true;
                    afkStatusMap.set(from, true);
                    const afkMessage = `⛔ *AFK LOG:*\n\n_${contactName}_ *Telah AFK 💤, Jangan Ganggu Dia...*\n\n🛏️ *INFO AFK:*\n\n*😴 Alasan AFK:* _${afkReason}_\n⏱️ *Waktu AFK:* _Hingga Selesai AFK (Default)_\n❗*Untuk Menghentikan AFK, ketik pai~stop-afk*`;
                    const sentMessage = await sock.sendMessage(from, { text: afkMessage });
                    messagesForChat.push(sentMessage.key);
                    console.log(`Message sent and stored with ID: ${sentMessage.key.id}`);
                }

            } else if (message === "pai~menu") {
                await sock.sendMessage(from, {text: `꧁𝚆𝙴𝙻𝙲𝙾𝙼𝙴 𝚃𝙾 🥧 𝙿𝙰𝙸 𝙼𝙴𝙽𝚄 ツ ꧂

╭●《 ⎈ *G R O U P* 》
 | ❐ pai~kick @tag
 | ❐ pai~ubah-gcdeskripsi <deskripsi>
 | ❐ pai~ubah-gcsetting
 | ❐ pai~ubah-gcnama <nama>
 | ❐ pai~list-gcreqgabung
 | ❐ pai~terima-listreqgabung
 | ❐ pai~tolak-listreqgabung
╰● NEXT 》`})

            } else if (message === "pai~stop-afk") {
                let afkStatus = afkStatusMap.get(from) || false;
                const contactName = msg.pushName || 'Unknown Contact';

                if (afkStatus) {
                    afkStatus = false;
                    afkStatusMap.delete(from);
                    await sock.sendMessage(from, { text: `🍀 *Status AFK* _${contactName}_ *Telah Selesai, Lanjutkan Aktivitasmu* 😁` });
                } else {
                    await sock.sendMessage(from, { text: `*⚠️ Peringatan!,* _${contactName}_ *Sedang Tidak Dalam Mode AFK. Ketik pai~afk untuk memulai afk!* 💤` });
                } 

            } else if (message.startsWith("pai~hapus-pesan")) {
                const parts = message.split(' ');
                const count = parseInt(parts[1]) || 10;

                const maxDeleteCount = 10;

                if (count > maxDeleteCount) {
                    await sock.sendMessage(from, { text: `⛔ *Maaf, batas maksimal pesan yang dapat dihapus adalah ${maxDeleteCount}.*` });
                    return;
                }
            
                const groupMetadata = await sock.groupMetadata(from);
                const participants = groupMetadata.participants;
                const senderId = msg.key.participant || from;
                const senderIsAdmin = participants.some(p => p.id === senderId && (p.admin === 'admin' || p.admin === 'superadmin'));
            
                const contactName = msg.pushName || 'Unknown Contact';
            
                if (!senderIsAdmin) {
                    await sock.sendMessage(from, { text: `⛔ _${contactName}_*, Kamu Bukan Admin!, Tidak Bisa Menghapus Pesan*` });
                    return;
                }
            
                if (messagesForChat.length === 0) {
                    await sock.sendMessage(from, { text: `⛔ *Tidak ada pesan yang bisa dihapus.*` });
                    return;
                }

                const myId = sock.user.jid;
            
                const messagesToDelete = messagesForChat.slice(-Math.min(count, 10));
            
                try {
                    const deleteMessagesPromises = messagesToDelete.map(async (messageKey) => {
                        await sock.sendMessage(from, {delete :{ remoteJid: messageKey.remoteJid, id: messageKey.id, participant: messageKey.participant}});
                    });

                    await Promise.all(deleteMessagesPromises);

                    await sock.sendMessage(from, { text: `*✅ Berhasil menghapus ${messagesToDelete.length} pesan.*` });
                } catch (error) {
                    console.error('Gagal menghapus pesan:', error);
                    await sock.sendMessage(from, { text: `*❌ Gagal menghapus pesan.*` });
                }

            } else if (message.startsWith("pai~kick")) {
                console.log("Received command to kick a user");
            
                const parts = message.split(' ');
                const userTag = parts[1];
            
                console.log("User tag to kick:", userTag);
            
                const senderId = msg.key.participant || from;
                const groupMetadata = await sock.groupMetadata(from);
                const participants = groupMetadata.participants;
                const senderIsAdmin = participants.some(p => p.id === senderId && (p.admin === 'admin' || p.admin === 'superadmin'));
            
                console.log("Sender ID:", senderId);
                console.log("Sender is admin:", senderIsAdmin);
            
                // Jika bukan admin, kirim pesan error
                if (!senderIsAdmin) {
                    const contactName = msg.pushName || 'Unknown Contact';
                    await sock.sendMessage(from, { text: `⛔ _${contactName}_*, Kamu Bukan Admin!, Tidak Bisa Kick Anggota*` });
                    return;
                }
            
                if (!userTag) {
                    await sock.sendMessage(from, { text: `⛔ *Mohon berikan tag pengguna yang ingin dikick. Contoh: pai~kick @nomor_telepon (tanpa - Misal 62838999777556)*` });
                    return;
                }
            
                // Cari participant berdasarkan user tag
                const participantId = userTag.replace('@', '') + '@s.whatsapp.net';
                const participant = participants.find(p => p.id === participantId);
            
                console.log("Participant to kick:", participant);
            
                if (!participant) {
                    await sock.sendMessage(from, { text: `⛔ *Pengguna dengan tag ${userTag} tidak ditemukan dalam grup.*` });
                    return;
                }

                if (participant.admin === 'admin' || participant.admin === 'superadmin') {
                    await sock.sendMessage(from, { text: `⚠️ *Pengguna dengan tag ${userTag} adalah admin. Jangan mencoba mengkick admin!*` });
                    return;
                }
            
                // Kick participant
                    await sock.groupParticipantsUpdate(from, [participant.id], 'remove');
                    await sock.sendMessage(from, { text: `✅ *Pengguna dengan tag ${userTag} berhasil dikick dari grup.*` });
                    console.log(`User ${participant.id} kicked successfully`);

            } else if (message.startsWith("pai~ubah-gcdeskripsi")) {
                const parts = message.split(' ');
                const newDescription = parts.slice(1).join(' ');

                if (!newDescription) {
                    await sock.sendMessage(from, { text: `⛔ *Mohon berikan deskripsi baru. Contoh: pai~ubah-gcdeskripsi <Deskripsi> baru untuk grup ini.*` });
                    return;
                }
            
                const groupMetadata = await sock.groupMetadata(from);
                const participants = groupMetadata.participants;
                const senderId = msg.key.participant || from;
                const senderIsAdmin = participants.some(p => p.id === senderId && (p.admin === 'admin' || p.admin === 'superadmin'));
            
                if (!senderIsAdmin) {
                    const contactName = msg.pushName || 'Unknown Contact';
                    await sock.sendMessage(from, { text: `⛔ _${contactName}_*, hanya admin yang dapat mengubah deskripsi grup.*` });
                    return;
                }
            
                try {
                    await sock.groupUpdateDescription(from, newDescription);
                    await sock.sendMessage(from, { text: `✅ *Deskripsi grup berhasil diubah menjadi:*\nNEW ==> ${newDescription}` });
                } catch (error) {
                    console.error('Gagal mengubah deskripsi grup:', error);
                    await sock.sendMessage(from, { text: `❌ *Gagal mengubah deskripsi grup. Silakan coba lagi nanti.*` });
                }

            } else if (message.startsWith("pai~ubah-gcnama")) {
                const parts = message.split(' ');
                const newTitle = parts.slice(1).join(' ');
            
                if (!newTitle) {
                    await sock.sendMessage(from, { text: `⛔ *Mohon berikan nama Grup baru. Contoh: pai~ubah-gcnama <Nama> Baru untuk Grup Ini.*` });
                    return;
                }
            
                const groupMetadata = await sock.groupMetadata(from);
                const participants = groupMetadata.participants;
                const senderId = msg.key.participant || from;
                const senderIsAdmin = participants.some(p => p.id === senderId && (p.admin === 'admin' || p.admin === 'superadmin'));
            
                if (!senderIsAdmin) {
                    const contactName = msg.pushName || 'Unknown Contact';
                    await sock.sendMessage(from, { text: `⛔ _${contactName}_*, hanya admin yang dapat mengubah judul grup.*` });
                    return;
                }
            
                try {
                    await sock.groupUpdateSubject(from, newTitle);
                    await sock.sendMessage(from, { text: `✅ *Judul grup berhasil diubah menjadi:*\nNEW ==> ${newTitle}` });
                } catch (error) {
                    console.error('Gagal mengubah judul grup:', error);
                    await sock.sendMessage(from, { text: `❌ *Gagal mengubah judul grup. Silakan coba lagi nanti.*` });
                }

            } else if (message.startsWith("pai~ubah-gcsetting")) {
                const parts = message.split(' ');
                const permission = parts[1];
            
                if (!permission) {
                    await sock.sendMessage(from, { text: `⛔ *Mohon berikan jenis izin. Contoh: pai~ubah-gcsetting onlyAdmin atau pai~ubah-gcsetting everyone*` });
                    return;
                }
            
                const groupMetadata = await sock.groupMetadata(from);
                const participants = groupMetadata.participants;
                const senderId = msg.key.participant || from;
                const senderIsAdmin = participants.some(p => p.id === senderId && (p.admin === 'admin' || p.admin === 'superadmin'));
            
                if (!senderIsAdmin) {
                    const contactName = msg.pushName || 'Unknown Contact';
                    await sock.sendMessage(from, { text: `⛔ _${contactName}_*, hanya admin yang dapat mengubah pengaturan grup.*` });
                    return;
                }
            
                try {
                    switch (permission.toLowerCase()) {
                        case 'onlyadmin':
                            // Mengatur pengaturan grup untuk hanya admin yang dapat berbicara di announcement dan memodifikasi foto profil
                            await sock.groupSettingUpdate(from, 'announcement');
                            await sock.groupSettingUpdate(from, 'locked');
                            await sock.sendMessage(from, { text: `✅ *Pengaturan grup diubah menjadi hanya ADMIN yang dapat berbicara di Grup dan memodifikasi foto profil Grup.*` });
                            break;
                        case 'everyone':
                            // Mengatur pengaturan grup untuk semua anggota dapat berbicara di announcement dan memodifikasi foto profil
                            await sock.groupSettingUpdate(from, 'not_announcement');
                            await sock.groupSettingUpdate(from, 'unlocked');
                            await sock.sendMessage(from, { text: `✅ *Pengaturan grup diubah menjadi SEMUA ANGGOTA dapat berbicara di Grup dan memodifikasi foto profil Grup.*` });
                            break;
                        default:
                            await sock.sendMessage(from, { text: `⛔ *Mohon berikan jenis izin yang valid. Hanya tersedia: onlyAdmin atau everyone.*` });
                            break;
                    }
                } catch (error) {
                    console.error('Gagal mengubah pengaturan grup:', error);
                    await sock.sendMessage(from, { text: `❌ *Gagal mengubah pengaturan grup. Silakan coba lagi nanti.*` });
                }

            } else if (message.startsWith("pai~list-gcreqgabung")) {
                try {
                    const response = await sock.groupRequestParticipantsList(from);
                    
                    if (response && response.participants && response.participants.length > 0) {
                        const requests = response.participants.map(participant => {
                            return `Nama: ${participant.name}, ID: ${participant.id}`;
                        }).join('\n');
                
                        await sock.sendMessage(from, { text: `📃 *Daftar Permintaan Bergabung:\n${requests}*` });
                    } else {
                        await sock.sendMessage(from, { text: '❌ *Sementara Tidak Ada yang Meminta Bergabung...*' });
                    }
                } catch (error) {
                    console.error('Gagal mengambil daftar permintaan bergabung:', error);
                    await sock.sendMessage(from, { text: '❌ *Terjadi Kesalahan saat Mengambil Data...*' });
                }
            }
            
            
        }
    });
};
startBot();