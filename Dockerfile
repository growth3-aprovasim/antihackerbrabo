# Usa a imagem oficial do Node.js versão 20 (Estável)
FROM node:20-slim

# Instala o git e ferramentas essenciais de compilação no sistema operacional do container
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Define a pasta de trabalho dentro do container
WORKDIR /app

# Copia os arquivos de dependência primeiro para otimizar o cache
COPY package.json ./

# Instala as dependências do projeto com suporte a git
RUN npm install

# Copia o restante do código do bot para dentro do container
COPY . .

# Comando padrão para iniciar o motor Aegis
CMD ["npm", "start"]