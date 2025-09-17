# Node version 
FROM node:lts

# Install system dependencies including FFmpeg
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Put the application code in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install all dependencies (including dev dependencies for building)
RUN npm install

# Copy the rest of the application code
COPY . .

# Ensure necessary directories exist and build the application
RUN npm run build && \
    mkdir -p /var/www/html/images && \
    chmod 755 /var/www/html/images && \
    mkdir -p ./uploads && \
    chmod 755 ./uploads

# Expose the application port
EXPOSE 3000

# Start the application
CMD ["node", "dist/app.js"]