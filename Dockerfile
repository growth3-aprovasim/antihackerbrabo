# Usa a imagem oficial do Node.js versão 20 (Estável)
FROM node:20-slim

# Define a pasta de trabalho dentro do container
WORKDIR /app

# Copia os arquivos de dependência primeiro para otimizar o cache
COPY package.json ./

# Instala as dependências do projeto limpas para produção
RUN npm install

# Copia o restante do código do bot para dentro do container
COPY . .

# Comando padrão para iniciar o motor Aegis
CMD ["npm", "start"]