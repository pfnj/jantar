const STORAGE_KEY = 'organizador_jantar_v8';

let participantes = [];
let restaurantes = [];
let pontoMedio = null;
let ordenacaoAtual = { coluna: 'votos', direcao: 'desc' };

let map = null;
let markersLayer = null;

// Inicialização ao carregar a página
document.addEventListener('DOMContentLoaded', () => {
    carregarEstado();
});

function guardarEstado() {
    const fsqKey = document.getElementById('foursquareKey').value.trim();
    const raio = parseInt(document.getElementById('raioPesquisa').value, 10) || 1500;
    const estado = {
        participantes,
        restaurantes,
        pontoMedio,
        ordenacaoAtual,
        fsqKey,
        raio
    };
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(estado));
    } catch (e) {
        console.warn('Não foi possível guardar no localStorage:', e);
    }
}

function carregarEstado() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;

        const estado = JSON.parse(raw);
        aplicarEstadoCarregado(estado);
    } catch (e) {
        console.warn('Erro ao carregar sessão guardada:', e);
    }
}

function aplicarEstadoCarregado(estado) {
    participantes = Array.isArray(estado.participantes) ? estado.participantes : [];
    restaurantes = Array.isArray(estado.restaurantes) ? estado.restaurantes : [];
    pontoMedio = estado.pontoMedio || null;
    ordenacaoAtual = estado.ordenacaoAtual || { coluna: 'votos', direcao: 'desc' };

    if (estado.fsqKey !== undefined) {
        document.getElementById('foursquareKey').value = estado.fsqKey;
    }
    if (estado.raio) {
        document.getElementById('raioPesquisa').value = String(estado.raio);
    }

    atualizarListaParticipantes();

    if (pontoMedio) {
        const infoCentro = document.getElementById('infoCentro');
        const linkMapaCentro = `https://www.openstreetmap.org/?mlat=${pontoMedio.lat}&mlon=${pontoMedio.lon}#map=15/${pontoMedio.lat}/${pontoMedio.lon}`;
        infoCentro.innerHTML = `📍 Ponto médio guardado: <strong>${pontoMedio.lat.toFixed(4)}, ${pontoMedio.lon.toFixed(4)}</strong> (<a href="${linkMapaCentro}" target="_blank" class="map-link">Ver no OpenStreetMap ↗</a>)`;
    } else {
        document.getElementById('infoCentro').innerHTML = '';
    }

    if (restaurantes.length > 0 || pontoMedio) {
        document.getElementById('seccaoVotacao').style.display = restaurantes.length > 0 ? 'block' : 'none';
        atualizarFiltroCozinhas();
        atualizarIconesOrdenacao();
        renderizarRestaurantes();
        atualizarMapa();
    } else {
        document.getElementById('seccaoVotacao').style.display = 'none';
        document.getElementById('mapContainer').style.display = 'none';
    }
}

function limparSessao() {
    if (!confirm('Tens a certeza que queres apagar todos os participantes, restaurantes e votos guardados?')) {
        return;
    }
    localStorage.removeItem(STORAGE_KEY);
    participantes = [];
    restaurantes = [];
    pontoMedio = null;
    ordenacaoAtual = { coluna: 'votos', direcao: 'desc' };

    document.getElementById('statusMsg').textContent = '';
    document.getElementById('infoCentro').textContent = '';
    document.getElementById('seccaoVotacao').style.display = 'none';
    document.getElementById('mapContainer').style.display = 'none';
    atualizarListaParticipantes();
}

// Exportar e Importar Sessão em JSON
function exportarSessaoJSON() {
    const fsqKey = document.getElementById('foursquareKey').value.trim();
    const raio = parseInt(document.getElementById('raioPesquisa').value, 10) || 1500;

    // Por segurança, não exporta a chave privada da API Foursquare por defeito
    const dadosExportacao = {
        versao: 8,
        exportadoEm: new Date().toISOString(),
        raio,
        participantes,
        pontoMedio,
        restaurantes,
        ordenacaoAtual
    };

    const jsonStr = JSON.stringify(dadosExportacao, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sessao-jantar-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function importarSessaoJSON(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const dados = JSON.parse(e.target.result);
            if (!dados || (!Array.isArray(dados.participantes) && !Array.isArray(dados.restaurantes))) {
                throw new Error('Estrutura de ficheiro inválida.');
            }
            aplicarEstadoCarregado(dados);
            guardarEstado();
            const statusMsg = document.getElementById('statusMsg');
            statusMsg.className = 'status success-text';
            statusMsg.textContent = `Sessão importada com sucesso (${participantes.length} participantes, ${restaurantes.length} restaurantes).`;
        } catch (err) {
            alert('Não foi possível importar o ficheiro JSON: ' + err.message);
        } finally {
            event.target.value = '';
        }
    };
    reader.readAsText(file);
}

// Converte combinação de Localidade (opcional) e Cidade em Latitude e Longitude
async function obterCoordenadas(localidade, cidade) {
    const termoPesquisa = localidade.toLowerCase() === cidade.toLowerCase()
        ? `${cidade}, Portugal`
        : `${localidade}, ${cidade}, Portugal`;

    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(termoPesquisa)}&countrycodes=pt&format=json&limit=1`;
    const response = await fetch(url, {
        headers: { 'Accept-Language': 'pt-PT' }
    });
    const data = await response.json();

    if (data && data.length > 0) {
        return {
            lat: parseFloat(data[0].lat),
            lon: parseFloat(data[0].lon),
            descricao: data[0].display_name.split(',').slice(0, 3).join(', ')
        };
    }
    throw new Error(`Não foi possível localizar "${termoPesquisa}". Verifica se os nomes estão corretos.`);
}

// Fórmula de Haversine para calcular a distância em metros entre dois pontos
function calcularDistanciaMetros(lat1, lon1, lat2, lon2) {
    if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
    const R = 6371e3;
    const rad = Math.PI / 180;
    const phi1 = lat1 * rad;
    const phi2 = lat2 * rad;
    const deltaPhi = (lat2 - lat1) * rad;
    const deltaLambda = (lon2 - lon1) * rad;

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return Math.round(R * c);
}

function formatarDistancia(metros) {
    if (metros === null || metros === undefined || isNaN(metros)) return '—';
    if (metros < 1000) {
        return `${metros} m`;
    }
    return `${(metros / 1000).toFixed(2)} km`;
}

function formatarPrecoSimbolo(nivel) {
    const n = parseInt(nivel, 10);
    if (!n || n < 1 || n > 4) return '—';
    return '€'.repeat(n);
}

async function adicionarParticipante() {
    const inputNome = document.getElementById('nome');
    const inputLocalidade = document.getElementById('localidade');
    const inputCidade = document.getElementById('cidade');
    const statusMsg = document.getElementById('statusMsg');
    const btnAdd = document.getElementById('btnAdd');

    const nome = inputNome.value.trim();
    const cidade = inputCidade.value.trim();
    const localidade = inputLocalidade.value.trim() || cidade;

    statusMsg.textContent = '';
    statusMsg.className = 'status';

    if (!nome || !cidade) {
        statusMsg.textContent = 'Por favor, preenche o nome e a cidade.';
        statusMsg.classList.add('error');
        return;
    }

    const textoLocal = localidade.toLowerCase() === cidade.toLowerCase()
        ? cidade
        : `${localidade}, ${cidade}`;

    try {
        btnAdd.disabled = true;
        statusMsg.textContent = `A localizar ${textoLocal}...`;

        const coords = await obterCoordenadas(localidade, cidade);

        participantes.push({
            id: Date.now(),
            nome,
            localidade,
            cidade,
            lat: coords.lat,
            lon: coords.lon,
            descricao: coords.descricao
        });

        inputNome.value = '';
        inputLocalidade.value = '';
        inputCidade.value = '';
        statusMsg.textContent = `${nome} adicionado(a) (${coords.descricao}).`;
        
        atualizarListaParticipantes();
        guardarEstado();
        if (map) atualizarMapa();
    } catch (err) {
        statusMsg.textContent = err.message;
        statusMsg.classList.add('error');
    } finally {
        btnAdd.disabled = false;
    }
}

function removerParticipante(id) {
    participantes = participantes.filter(p => p.id !== id);
    atualizarListaParticipantes();
    guardarEstado();
    if (map) atualizarMapa();
}

function atualizarListaParticipantes() {
    const lista = document.getElementById('listaParticipantes');
    const btnCalcular = document.getElementById('btnCalcular');
    lista.innerHTML = '';

    participantes.forEach(p => {
        const etiquetaLocal = p.localidade.toLowerCase() === p.cidade.toLowerCase()
            ? p.cidade
            : `${p.localidade}, ${p.cidade}`;

        const li = document.createElement('li');
        li.innerHTML = `
            <div>
                <strong>${p.nome}</strong> — <span class="badge">${etiquetaLocal}</span>
                <span style="font-size: 13px; color: #64748b;">(${p.descricao})</span>
            </div>
            <button class="danger" onclick="removerParticipante(${p.id})">Remover</button>
        `;
        lista.appendChild(li);
    });

    btnCalcular.disabled = participantes.length === 0;
}

// Pesquisa via Foursquare Places API (com ratings e preços reais)
async function pesquisarFoursquare(lat, lon, raio, apiKey) {
    const url = `https://api.foursquare.com/v3/places/search?ll=${lat},${lon}&radius=${raio}&categories=13065&fields=fsq_id,name,geocodes,categories,rating,price&limit=20`;
    const response = await fetch(url, {
        headers: {
            'Authorization': apiKey,
            'Accept': 'application/json'
        }
    });

    if (!response.ok) {
        throw new Error(`Erro na API Foursquare (${response.status}). Verifica a tua chave.`);
    }

    const data = await response.json();
    return (data.results || []).map(place => {
        const pLat = place.geocodes?.main?.latitude ?? lat;
        const pLon = place.geocodes?.main?.longitude ?? lon;
        const categorias = place.categories && place.categories.length > 0
            ? place.categories.map(c => c.name).join(', ')
            : 'Restaurante';

        const ratingConvertido = place.rating ? Number((place.rating / 2).toFixed(1)) : null;
        const precoNivel = place.price ? Number(place.price) : null;

        return {
            id: place.fsq_id,
            nome: place.name,
            cozinha: categorias,
            rating: ratingConvertido,
            preco: precoNivel,
            distancia: calcularDistanciaMetros(lat, lon, pLat, pLon),
            lat: pLat,
            lon: pLon,
            votos: 0,
            manual: false
        };
    });
}

// Pesquisa gratuita via OpenStreetMap (Overpass API)
async function pesquisarOverpass(lat, lon, raio) {
    const query = `
        [out:json][timeout:15];
        node["amenity"="restaurant"](around:${raio},${lat},${lon});
        out body 30;
    `;
    const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
    const response = await fetch(url);
    const data = await response.json();

    const validos = (data.elements || []).filter(el => el.tags && el.tags.name);
    return validos.map(el => {
        let rating = null;
        if (el.tags.rating) {
            const parsed = parseFloat(el.tags.rating);
            if (!isNaN(parsed)) rating = parsed;
        } else if (el.tags.stars) {
            const parsed = parseFloat(el.tags.stars);
            if (!isNaN(parsed)) rating = parsed;
        }

        // Estimativa opcional caso exista tag charge/price no OSM
        let preco = null;
        if (el.tags.price) {
            const euros = (el.tags.price.match(/€/g) || []).length;
            if (euros >= 1 && euros <= 4) preco = euros;
        }

        return {
            id: String(el.id),
            nome: el.tags.name,
            cozinha: el.tags.cuisine ? el.tags.cuisine.replace(/;/g, ', ') : 'Cozinha variada',
            rating: rating,
            preco: preco,
            distancia: calcularDistanciaMetros(lat, lon, el.lat, el.lon),
            lat: el.lat,
            lon: el.lon,
            votos: 0,
            manual: false
        };
    });
}

// Calcula o centroide e procura restaurantes
async function encontrarRestaurantes() {
    const btnCalcular = document.getElementById('btnCalcular');
    const infoCentro = document.getElementById('infoCentro');
    const seccaoVotacao = document.getElementById('seccaoVotacao');
    const fsqKey = document.getElementById('foursquareKey').value.trim();
    const raio = parseInt(document.getElementById('raioPesquisa').value, 10) || 1500;
    const raioTexto = raio < 1000 ? `${raio} m` : `${(raio / 1000).toString().replace('.', ',')} km`;

    btnCalcular.disabled = true;
    infoCentro.className = 'status';
    infoCentro.textContent = `A calcular ponto médio e a pesquisar restaurantes num raio de ${raioTexto}...`;

    const somaLat = participantes.reduce((acc, p) => acc + p.lat, 0);
    const somaLon = participantes.reduce((acc, p) => acc + p.lon, 0);
    const mediaLat = somaLat / participantes.length;
    const mediaLon = somaLon / participantes.length;
    pontoMedio = { lat: mediaLat, lon: mediaLon };

    const linkMapaCentro = `https://www.openstreetmap.org/?mlat=${mediaLat}&mlon=${mediaLon}#map=15/${mediaLat}/${mediaLon}`;
    infoCentro.innerHTML = `📍 Ponto médio encontrado: <strong>${mediaLat.toFixed(4)}, ${mediaLon.toFixed(4)}</strong> (<a href="${linkMapaCentro}" target="_blank" class="map-link">Ver no OpenStreetMap ↗</a>)`;

    try {
        let resultados = [];
        if (fsqKey) {
            resultados = await pesquisarFoursquare(mediaLat, mediaLon, raio, fsqKey);
        } else {
            resultados = await pesquisarOverpass(mediaLat, mediaLon, raio);
        }

        // Preservar restaurantes adicionados manualmente e recalcular a sua distância
        const manuais = restaurantes.filter(r => r.manual).map(r => ({
            ...r,
            distancia: calcularDistanciaMetros(mediaLat, mediaLon, r.lat, r.lon)
        }));

        if (resultados.length === 0 && manuais.length === 0) {
            infoCentro.innerHTML += `<br><span class="error">Não foram encontrados restaurantes num raio de ${raioTexto}. Experimenta aumentar o raio ou adicionar sugestões manualmente.</span>`;
            atualizarMapa();
            guardarEstado();
            btnCalcular.disabled = false;
            return;
        }

        resultados.sort((a, b) => a.distancia - b.distancia);
        restaurantes = [...manuais, ...resultados.slice(0, 20)];

        ordenacaoAtual = { coluna: 'votos', direcao: 'desc' };
        atualizarIconesOrdenacao();
        atualizarFiltroCozinhas();

        seccaoVotacao.style.display = 'block';
        renderizarRestaurantes();
        atualizarMapa();
        guardarEstado();
    } catch (err) {
        infoCentro.innerHTML += `<br><span class="error">${err.message || 'Erro ao contactar o serviço de mapas. Tenta novamente.'}</span>`;
    } finally {
        btnCalcular.disabled = false;
    }
}

// Adicionar restaurante manualmente
async function adicionarRestauranteManual() {
    const inputNome = document.getElementById('manualNome');
    const inputCozinha = document.getElementById('manualCozinha');
    const inputLocal = document.getElementById('manualLocal');
    const selectPreco = document.getElementById('manualPreco');
    const inputRating = document.getElementById('manualRating');
    const manualStatus = document.getElementById('manualStatus');
    const btnManual = document.getElementById('btnManualAdd');

    const nome = inputNome.value.trim();
    const cozinha = inputCozinha.value.trim() || 'Sugestão manual';
    const local = inputLocal.value.trim();
    const preco = selectPreco.value ? parseInt(selectPreco.value, 10) : null;
    const ratingVal = parseFloat(inputRating.value);
    const rating = (!isNaN(ratingVal) && ratingVal >= 0 && ratingVal <= 5) ? Number(ratingVal.toFixed(1)) : null;

    manualStatus.textContent = '';
    manualStatus.className = 'status';

    if (!nome) {
        manualStatus.textContent = 'Insere o nome do restaurante.';
        manualStatus.classList.add('error');
        return;
    }

    let lat = null;
    let lon = null;
    let distancia = null;

    try {
        btnManual.disabled = true;
        if (local) {
            manualStatus.textContent = `A localizar "${local}"...`;
            const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(local + ', Portugal')}&countrycodes=pt&format=json&limit=1`;
            const resp = await fetch(url, { headers: { 'Accept-Language': 'pt-PT' } });
            const data = await resp.json();
            if (data && data.length > 0) {
                lat = parseFloat(data[0].lat);
                lon = parseFloat(data[0].lon);
                if (pontoMedio) {
                    distancia = calcularDistanciaMetros(pontoMedio.lat, pontoMedio.lon, lat, lon);
                }
            }
        }

        restaurantes.unshift({
            id: 'manual-' + Date.now(),
            nome,
            cozinha,
            rating,
            preco,
            distancia,
            lat,
            lon,
            votos: 1,
            manual: true
        });

        inputNome.value = '';
        inputCozinha.value = '';
        inputLocal.value = '';
        inputRating.value = '';
        manualStatus.className = 'status success-text';
        manualStatus.textContent = `"${nome}" adicionado à lista!`;

        document.getElementById('seccaoVotacao').style.display = 'block';
        atualizarFiltroCozinhas();
        renderizarRestaurantes();
        atualizarMapa();
        guardarEstado();
    } catch (e) {
        manualStatus.textContent = 'Erro ao adicionar restaurante manual.';
        manualStatus.classList.add('error');
    } finally {
        btnManual.disabled = false;
    }
}

function removerRestaurante(id) {
    restaurantes = restaurantes.filter(r => r.id !== id);
    atualizarFiltroCozinhas();
    renderizarRestaurantes();
    atualizarMapa();
    guardarEstado();
}

// Mapa Interativo (Leaflet)
function atualizarMapa() {
    const container = document.getElementById('mapContainer');
    if (participantes.length === 0 && !pontoMedio && restaurantes.length === 0) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';

    if (!map) {
        map = L.map('map').setView([38.7223, -9.1393], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(map);
        markersLayer = L.layerGroup().addTo(map);
    }

    setTimeout(() => { map.invalidateSize(); }, 100);
    markersLayer.clearLayers();

    const bounds = [];

    // 1. Marcadores dos Participantes (Azul)
    participantes.forEach(p => {
        const marker = L.circleMarker([p.lat, p.lon], {
            radius: 8,
            fillColor: '#2563eb',
            color: '#ffffff',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.9
        }).bindPopup(`<strong>👤 ${p.nome}</strong><br>${p.localidade}, ${p.cidade}`);
        markersLayer.addLayer(marker);
        bounds.push([p.lat, p.lon]);
    });

    // 2. Marcador do Ponto Médio e círculo do raio escolhido (Vermelho)
    if (pontoMedio) {
        const raio = parseInt(document.getElementById('raioPesquisa').value, 10) || 1500;
        const centerMarker = L.circleMarker([pontoMedio.lat, pontoMedio.lon], {
            radius: 10,
            fillColor: '#dc2626',
            color: '#ffffff',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.95
        }).bindPopup(`<strong>📍 Ponto Médio</strong><br>${pontoMedio.lat.toFixed(4)}, ${pontoMedio.lon.toFixed(4)}`);
        markersLayer.addLayer(centerMarker);

        const circle = L.circle([pontoMedio.lat, pontoMedio.lon], {
            radius: raio,
            color: '#dc2626',
            fillColor: '#dc2626',
            fillOpacity: 0.05,
            weight: 1,
            dashArray: '4, 4'
        });
        markersLayer.addLayer(circle);
        bounds.push([pontoMedio.lat, pontoMedio.lon]);
    }

    // 3. Marcadores dos Restaurantes (Verde)
    restaurantes.forEach(r => {
        if (r.lat != null && r.lon != null) {
            const notaTxt = r.rating !== null ? ` | ⭐ ${r.rating}/5` : '';
            const precoTxt = r.preco ? ` | ${formatarPrecoSimbolo(r.preco)}` : '';
            const marker = L.circleMarker([r.lat, r.lon], {
                radius: 7,
                fillColor: '#16a34a',
                color: '#ffffff',
                weight: 2,
                opacity: 1,
                fillOpacity: 0.9
            }).bindPopup(`<strong>🍽️ ${r.nome}</strong><br>${r.cozinha}${precoTxt}${notaTxt}<br>Votos: <strong>${r.votos}</strong>`);
            markersLayer.addLayer(marker);
            bounds.push([r.lat, r.lon]);
        }
    });

    if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [35, 35], maxZoom: 15 });
    }
}

function atualizarFiltroCozinhas() {
    const select = document.getElementById('filtroCozinha');
    const valorAtual = select.value;
    const conjuntoCozinhas = new Set();

    restaurantes.forEach(r => {
        r.cozinha.split(',').forEach(item => {
            const limpa = item.trim().toLowerCase();
            if (limpa && limpa !== 'cozinha variada') {
                conjuntoCozinhas.add(limpa);
            }
        });
    });

    const listaOrdenada = Array.from(conjuntoCozinhas).sort((a, b) => a.localeCompare(b, 'pt'));
    select.innerHTML = '<option value="">Todas as cozinhas</option>';

    listaOrdenada.forEach(cozinha => {
        const option = document.createElement('option');
        option.value = cozinha;
        option.textContent = cozinha.charAt(0).toUpperCase() + cozinha.slice(1);
        select.appendChild(option);
    });

    if (listaOrdenada.includes(valorAtual)) {
        select.value = valorAtual;
    }
}

function atualizarRatingManual(id, valor) {
    const rest = restaurantes.find(r => r.id === id);
    if (!rest) return;

    if (valor === '' || valor === null) {
        rest.rating = null;
    } else {
        const num = parseFloat(valor);
        if (!isNaN(num)) {
            rest.rating = Math.min(5, Math.max(0, Number(num.toFixed(1))));
        }
    }
    guardarEstado();
    atualizarMapa();
    if (ordenacaoAtual.coluna === 'rating') {
        renderizarRestaurantes();
    }
}

function atualizarPrecoManual(id, valor) {
    const rest = restaurantes.find(r => r.id === id);
    if (!rest) return;

    const num = parseInt(valor, 10);
    rest.preco = (num >= 1 && num <= 4) ? num : null;

    guardarEstado();
    atualizarMapa();
    if (ordenacaoAtual.coluna === 'preco') {
        renderizarRestaurantes();
    }
}

function ordenarPor(coluna) {
    if (ordenacaoAtual.coluna === coluna) {
        ordenacaoAtual.direcao = ordenacaoAtual.direcao === 'asc' ? 'desc' : 'asc';
    } else {
        ordenacaoAtual.coluna = coluna;
        ordenacaoAtual.direcao = (coluna === 'votos' || coluna === 'rating') ? 'desc' : 'asc';
    }
    atualizarIconesOrdenacao();
    renderizarRestaurantes();
    guardarEstado();
}

function atualizarIconesOrdenacao() {
    const colunas = ['nome', 'preco', 'rating', 'distancia', 'votos'];
    colunas.forEach(col => {
        const el = document.getElementById(`sort-${col}`);
        if (!el) return;
        if (ordenacaoAtual.coluna === col) {
            el.textContent = ordenacaoAtual.direcao === 'asc' ? '↑' : '↓';
        } else {
            el.textContent = '↕';
        }
    });
}

function votar(id, delta) {
    const rest = restaurantes.find(r => r.id === id);
    if (rest) {
        rest.votos = Math.max(0, rest.votos + delta);
        renderizarRestaurantes();
        atualizarMapa();
        guardarEstado();
    }
}

function obterRestaurantesFiltradosEOrdenados() {
    const texto = document.getElementById('filtroTexto').value.trim().toLowerCase();
    const cozinhaSelecionada = document.getElementById('filtroCozinha').value.toLowerCase();
    const precoSelecionado = document.getElementById('filtroPreco').value;

    const filtrados = restaurantes.filter(r => {
        const correspondeNome = r.nome.toLowerCase().includes(texto);
        const correspondeCozinha = !cozinhaSelecionada || r.cozinha.toLowerCase().includes(cozinhaSelecionada);
        const correspondePreco = !precoSelecionado || String(r.preco) === precoSelecionado;
        return correspondeNome && correspondeCozinha && correspondePreco;
    });

    const fator = ordenacaoAtual.direcao === 'asc' ? 1 : -1;
    const col = ordenacaoAtual.coluna;

    return filtrados.sort((a, b) => {
        if (col === 'nome') {
            return a.nome.localeCompare(b.nome, 'pt') * fator;
        }
        if (col === 'preco') {
            if (a.preco === null && b.preco === null) return 0;
            if (a.preco === null) return 1;
            if (b.preco === null) return -1;
            return (a.preco - b.preco) * fator;
        }
        if (col === 'rating') {
            if (a.rating === null && b.rating === null) return 0;
            if (a.rating === null) return 1;
            if (b.rating === null) return -1;
            return (a.rating - b.rating) * fator;
        }
        if (col === 'distancia') {
            if (a.distancia === null && b.distancia === null) return 0;
            if (a.distancia === null) return 1;
            if (b.distancia === null) return -1;
            return (a.distancia - b.distancia) * fator;
        }
        if (col === 'votos') {
            if (b.votos !== a.votos) {
                return (a.votos - b.votos) * fator;
            }
            return (a.distancia ?? 999999) - (b.distancia ?? 999999);
        }
        return 0;
    });
}

function renderizarRestaurantes() {
    const tbody = document.getElementById('corpoTabelaRestaurantes');
    tbody.innerHTML = '';

    const ordenados = obterRestaurantesFiltradosEOrdenados();
    const maxVotos = restaurantes.reduce((max, r) => Math.max(max, r.votos), 0);

    if (ordenados.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; color: #64748b; padding: 20px;">
                    Nenhum restaurante corresponde aos filtros selecionados.
                </td>
            </tr>
        `;
        return;
    }

    ordenados.forEach(r => {
        const isWinner = maxVotos > 0 && r.votos === maxVotos;
        const queryMapa = (r.lat != null && r.lon != null)
            ? `${encodeURIComponent(r.nome)}+${r.lat},${r.lon}`
            : `${encodeURIComponent(r.nome)}`;
        const mapUrl = `https://www.google.com/maps/search/?api=1&query=${queryMapa}`;
        const valorRating = r.rating !== null ? r.rating : '';
        const valorPreco = r.preco !== null ? String(r.preco) : '';

        const tr = document.createElement('tr');
        if (isWinner) tr.className = 'winner';

        tr.innerHTML = `
            <td>
                <div class="rest-name">
                    ${r.nome}
                    ${isWinner ? '<span class="badge winner-badge">Mais Votado</span>' : ''}
                    ${r.manual ? '<span class="badge manual-badge">Manual</span>' : ''}
                </div>
                <div class="rest-cuisine">${r.cozinha}</div>
                <a href="${mapUrl}" target="_blank" class="map-link">Ver no Google Maps ↗</a>
            </td>
            <td>
                <select class="price-select" onchange="atualizarPrecoManual('${r.id}', this.value)" title="Orçamento / Preço médio">
                    <option value="" ${valorPreco === '' ? 'selected' : ''}>—</option>
                    <option value="1" ${valorPreco === '1' ? 'selected' : ''}>€</option>
                    <option value="2" ${valorPreco === '2' ? 'selected' : ''}>€€</option>
                    <option value="3" ${valorPreco === '3' ? 'selected' : ''}>€€€</option>
                    <option value="4" ${valorPreco === '4' ? 'selected' : ''}>€€€€</option>
                </select>
            </td>
            <td>
                <div class="rating-edit" title="Podes editar ou preencher a nota manualmente (0 a 5)">
                    <span>⭐</span>
                    <input type="number" class="rating-input" min="0" max="5" step="0.1"
                           placeholder="—" value="${valorRating}"
                           onchange="atualizarRatingManual('${r.id}', this.value)">
                </div>
            </td>
            <td class="distance-badge">${formatarDistancia(r.distancia)}</td>
            <td>
                <div class="vote-controls">
                    <button class="vote-btn minus" onclick="votar('${r.id}', -1)">-</button>
                    <span class="vote-count">${r.votos}</span>
                    <button class="vote-btn" onclick="votar('${r.id}', 1)">+ Votar</button>
                    <button class="btn-remove-row" onclick="removerRestaurante('${r.id}')" title="Remover restaurante">✕</button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function gerarTextoResumo() {
    const linhas = [];
    linhas.push('🍽️ *RESULTADO DO ORGANIZADOR DE JANTAR*');
    linhas.push('');

    if (participantes.length > 0) {
        linhas.push(`👥 *Participantes (${participantes.length}):*`);
        participantes.forEach(p => {
            const local = p.localidade.toLowerCase() === p.cidade.toLowerCase() ? p.cidade : `${p.localidade}, ${p.cidade}`;
            linhas.push(`- ${p.nome} (${local})`);
        });
        linhas.push('');
    }

    if (pontoMedio) {
        linhas.push(`📍 *Ponto Médio:* ${pontoMedio.lat.toFixed(4)}, ${pontoMedio.lon.toFixed(4)}`);
        linhas.push('');
    }

    const ranking = [...restaurantes].sort((a, b) => b.votos - a.votos || (a.distancia ?? 999999) - (b.distancia ?? 999999));
    const maisVotado = ranking[0];

    if (maisVotado && maisVotado.votos > 0) {
        const notaTxt = maisVotado.rating !== null ? ` | ⭐ ${maisVotado.rating}/5` : '';
        const precoTxt = maisVotado.preco ? ` | ${formatarPrecoSimbolo(maisVotado.preco)}` : '';
        const queryMapa = (maisVotado.lat != null && maisVotado.lon != null)
            ? `${encodeURIComponent(maisVotado.nome)}+${maisVotado.lat},${maisVotado.lon}`
            : `${encodeURIComponent(maisVotado.nome)}`;
        const mapUrl = `https://www.google.com/maps/search/?api=1&query=${queryMapa}`;
        linhas.push(`🏆 *Restaurante Escolhido:* ${maisVotado.nome} (${maisVotado.votos} votos${precoTxt}${notaTxt})`);
        linhas.push(`🗺️ Mapa: ${mapUrl}`);
        linhas.push('');
    }

    linhas.push('📊 *Classificação Geral da Votação:*');
    ranking.forEach((r, idx) => {
        const notaTxt = r.rating !== null ? ` | ⭐ ${r.rating}/5` : '';
        const precoTxt = r.preco ? ` | ${formatarPrecoSimbolo(r.preco)}` : '';
        const distTxt = r.distancia !== null ? ` | ${formatarDistancia(r.distancia)}` : '';
        linhas.push(`${idx + 1}. ${r.nome} — ${r.votos} voto(s)${precoTxt}${notaTxt}${distTxt}`);
    });

    return linhas.join('\n');
}

async function copiarResumo() {
    const status = document.getElementById('exportStatus');
    const texto = gerarTextoResumo();

    try {
        await navigator.clipboard.writeText(texto);
        status.className = 'status success-text';
        status.textContent = '✅ Resumo copiado para a área de transferência!';
    } catch (err) {
        status.className = 'status error';
        status.textContent = 'Não foi possível copiar automaticamente. Usa o botão Descarregar TXT.';
    }
}

function descarregarTXT() {
    const status = document.getElementById('exportStatus');
    const texto = gerarTextoResumo();
    const blob = new Blob([texto], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'resultado-jantar.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    status.className = 'status success-text';
    status.textContent = '✅ Ficheiro resultado-jantar.txt descarregado!';
}
