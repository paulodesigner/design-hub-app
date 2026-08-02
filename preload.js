// A única porta entre a interface e o processo principal.
// O renderer não tem Node, não tem filesystem e não tem SDK — só estas funções.

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('hub', {
  // Estado do Hub e do elenco de agentes
  estado: () => ipcRenderer.invoke('hub:estado'),
  escolher: () => ipcRenderer.invoke('hub:escolher'),
  abrirPasta: () => ipcRenderer.invoke('hub:abrir-pasta'),
  procurar: () => ipcRenderer.invoke('hub:procurar'),
  usar: (caminho) => ipcRenderer.invoke('hub:usar', { caminho }),
  prontidao: (revalidar) => ipcRenderer.invoke('hub:prontidao', { revalidar }),
  sincronizar: () => ipcRenderer.invoke('hub:sincronizar'),
  clonar: () => ipcRenderer.invoke('hub:clonar'),
  anexar: () => ipcRenderer.invoke('hub:anexar'),

  // Conversas
  listar: () => ipcRenderer.invoke('conversas:listar'),
  criar: (dados) => ipcRenderer.invoke('conversas:criar', dados || {}),
  abrir: (id) => ipcRenderer.invoke('conversas:abrir', { id }),
  gravarFio: (id, fio) => ipcRenderer.invoke('conversas:gravar-fio', { id, fio }),
  atualizar: (id, mudancas) => ipcRenderer.invoke('conversas:atualizar', { id, mudancas }),
  reiniciar: (id) => ipcRenderer.invoke('conversas:reiniciar', { id }),
  excluir: (id) => ipcRenderer.invoke('conversas:excluir', { id }),

  // Turno
  enviar: (id, texto, anexos) => ipcRenderer.invoke('conversa:enviar', { id, texto, anexos }),
  parar: (id) => ipcRenderer.invoke('conversa:parar', { id }),
  responderPermissao: (id, aprovado) => ipcRenderer.send('permissao:responder', { id, aprovado }),

  aoReceber: (callback) => {
    const ouvinte = (_e, dados) => callback(dados)
    ipcRenderer.on('agente:evento', ouvinte)
    return () => ipcRenderer.removeListener('agente:evento', ouvinte)
  },
})
