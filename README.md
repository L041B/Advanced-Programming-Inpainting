# P.A. Inpainting

<div align="center">
  <!-- Technology badges with logos and links -->
  <a href="https://www.postman.com/" target="_blank">
    <img src="https://img.shields.io/badge/Postman-FF6C37?logo=postman&logoColor=white&style=for-the-badge" alt="Postman" />
  </a>
  <a href="https://github.com/" target="_blank">
    <img src="https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white&style=for-the-badge" alt="GitHub" />
  </a>
  <a href="https://jestjs.io/" target="_blank">
    <img src="https://img.shields.io/badge/Jest-C21325?logo=jest&logoColor=white&style=for-the-badge" alt="Jest" />
  </a>
  <a href="https://jwt.io/" target="_blank">
    <img src="https://img.shields.io/badge/JWT-000000?logo=jsonwebtokens&logoColor=white&style=for-the-badge" alt="JWT" />
  </a>
  <a href="https://sequelize.org/" target="_blank">
    <img src="https://img.shields.io/badge/Sequelize-52B0E7?logo=sequelize&logoColor=white&style=for-the-badge" alt="Sequelize" />
  </a>
  <a href="https://www.python.org/" target="_blank">
    <img src="https://img.shields.io/badge/Python-3776AB?logo=python&logoColor=white&style=for-the-badge" alt="Python" />
  </a>
  <a href="https://www.javascript.com/" target="_blank">
    <img src="https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black&style=for-the-badge" alt="JavaScript" />
  </a>
  <a href="https://www.typescriptlang.org/" target="_blank">
    <img src="https://img.shields.io/badge/TypeScript-3178c6?logo=typescript&logoColor=white&style=for-the-badge" alt="TypeScript" />
  </a>
  <a href="https://nodejs.org/" target="_blank">
    <img src="https://img.shields.io/badge/Node.js-339933?logo=node.js&logoColor=white&style=for-the-badge" alt="Node.js" />
  </a>
  <a href="https://expressjs.com/" target="_blank">
    <img src="https://img.shields.io/badge/Express-000000?logo=express&logoColor=white&style=for-the-badge" alt="Express" />
  </a>
  <a href="https://www.docker.com/" target="_blank">
    <img src="https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white&style=for-the-badge" alt="Docker" />
  </a>
  <a href="https://docs.docker.com/compose/" target="_blank">
    <img src="https://img.shields.io/badge/Docker%20Compose-142f46?logo=docker&logoColor=white&style=for-the-badge" alt="Docker Compose" />
  </a>
  <a href="https://eslint.org/" target="_blank">
    <img src="https://img.shields.io/badge/ESLint-4B32C3?logo=eslint&logoColor=white&style=for-the-badge" alt="ESLint" />
  </a>
  <a href="https://pylint.org/" target="_blank">
    <img src="https://img.shields.io/badge/Pylint-4B8BBE?logo=python&logoColor=white&style=for-the-badge" alt="Pylint" />
  </a>
  <a href="https://www.sonarsource.com/products/sonarqube/" target="_blank">
    <img src="https://img.shields.io/badge/SonarQube-4E9BCD?logo=sonarqube&logoColor=white&style=for-the-badge" alt="SonarQube" />
  </a>
  <a href="https://redis.io/" target="_blank">
    <img src="https://img.shields.io/badge/Redis-DC382D?logo=redis&logoColor=white&style=for-the-badge" alt="Redis" />
  </a>
  <a href="https://www.postgresql.org/" target="_blank">
    <img src="https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white&style=for-the-badge" alt="PostgreSQL" />
  </a>
  <a href="https://github.com/OptimalBits/bull" target="_blank">
    <img src="https://img.shields.io/badge/Bull-EA1B1B?logo=redis&logoColor=white&style=for-the-badge" alt="Bull" />
  </a>
  <a href="https://www.npmjs.com/" target="_blank">
    <img src="https://img.shields.io/badge/NPM-CB3837?logo=npm&logoColor=white&style=for-the-badge" alt="NPM" />
  </a>
  <a href="https://axios-http.com/" target="_blank">
    <img src="https://img.shields.io/badge/Axios-5A29E4?logo=axios&logoColor=white&style=for-the-badge" alt="Axios" />
  </a>
  <a href="https://www.npmjs.com/package/bcrypt" target="_blank">
    <img src="https://img.shields.io/badge/Bcrypt-1A1A1A?logo=bcrypt&logoColor=white&style=for-the-badge" alt="Bcrypt" />
  </a>
  <a href="https://github.com/expressjs/multer" target="_blank">
    <img src="https://img.shields.io/badge/Multer-4B4B4B?logo=multer&logoColor=white&style=for-the-badge" alt="Multer" />
  </a>
  <a href="https://helmetjs.github.io/" target="_blank">
    <img src="https://img.shields.io/badge/Helmet-006400?logo=helmet&logoColor=white&style=for-the-badge" alt="Helmet" />
  </a>
  <a href="https://github.com/winstonjs/winston" target="_blank">
    <img src="https://img.shields.io/badge/Winston-4F4F4F?logo=winston&logoColor=white&style=for-the-badge" alt="Winston" />
  </a>
</div>
 
---
 
## Introduction
 
**P.A. Inpainting** is a Node.js backend service. It supports dataset and inference management for images, masks, and videos, using a queue-based architecture for scalable processing. The system enforces a token-based credit model for users, with costs per operation and admin recharge capabilities.
 
---
 
## 📑 Index
 
- [Main Features](#main-features)
- [ZIP Format](#zip-format)
- [Installation](#installation)
- [Environment Setup](#environment-setup)
- [API Documentation](#api-documentation)
- [API Routes & Responses](#api-routes--responses)
- [Postman Collection for API Testing](#postman-collection-for-api-testing)
- [Database Structure](#database-structure)
- [System Architecture](#system-architecture)
- [Inference Workflow](#inference-workflow-worker--external-service)
- [Patterns](#patterns)
- [Diagrams](#diagrams)
- [Testing](#testing)
- [Linting & Code Quality](#linting--code-quality)
 
---
### Main Features
 
- **User Management & Authentication**
  - Secure JWT-based authentication
  - User registration with bcrypt password hashing
  - Role-based access (User, Admin)
  - Protected API endpoints (JWT required, except register and login)
 
- **Token & Credit System**
  - Each authenticated user has a token balance
  - Operation costs vary by type (image/video/zip upload, inference):
      - Image upload: `0.65 token/image`
      - ZIP upload: `0.7 token/valid file`
      - Video upload: `0.4 token/frame`
      - Inference: `2.75 token/image`, `1.5 token/frame`
  - Operations are denied if credits are insufficient (`401 Unauthorized`).
  - Credit balance is stored in the DB and can be checked via a protected route.
 
- **Dataset Management**
  - CRUD operations on datasets (logical delete supported)
  - Multi-format upload:
    - Image + mask pairs
    - Videos (with mask or mask video)
    - ZIP archives (structured dataset folders)
  - Media processing:
    - Frame extraction from videos (1 FPS with FFmpeg)
    - Mask validation (binary check with Sharp)
  - Secure data access via signed URLs (JWT-based)
 
- **Asynchronous Inference System**
  - Job queueing with Redis + Bull
  - Background processing by separate worker
  - Worker → Python microservice (Flask + OpenCV) for inference
  - Job status tracking: PENDING, RUNNING, COMPLETED, FAILED, ABORTED
  - Result retrieval via API + secure download links
 
- **Administration Features**
  - Admin token recharge for users
  - Monitoring dashboard APIs:
    - Full list of datasets (including orphaned ones)
    - Full list of token transactions
 
 
---
 
### ZIP Format
 
 
- The ZIP archive must contain **subfolders**, each representing a dataset group.
- Inside each subfolder, files must be organized as **image/video + mask pairs**:
  - The **mask file** must contain the word `mask` in its filename.
  - If multiple pairs exist, they must be indexed numerically (`image_1.png` + `mask_1.png`, `video_2.mp4` + `mask_2.png`, etc.).
- **Supported file formats**:  
  - Images: `.png`, `.jpg`, `.jpeg`  
  - Videos: `.mp4`, `.avi`  
  - All other formats are ignored.
- On upload, files from the ZIP are stored under the `image` field.  
  Since the upload method also expects a `mask` field, this will be populated with a placeholder file (ignored by the system).
 
### Example Structure
 
```plaintext
dataset.zip
│
├── group1/
│   ├── image_1.png
│   ├── mask_1.png
│   ├── video_2.mp4
│   ├── mask_2.png
│   └── notes.txt   (ignored)
│
├── group2/
│   ├── sample_1.jpg
│   ├── mask_1.jpg
│   ├── sample_2.jpeg
│   └── mask_2.jpeg
│
└── group3/
    ├── clip_1.avi
    └── mask_1.png
```
--- 
## Installation
 
### Requirements
 
- [Node.js](https://nodejs.org/) (v22+)
- [Docker](https://www.docker.com/) & [Docker Compose](https://docs.docker.com/compose/)
- [Redis](https://redis.io/) (via Docker)
- [PostgreSQL](https://www.postgresql.org/) (via Docker)
- [Python 3.9+](https://www.python.org/) (for inference service, handled by Docker)
 
### Quick Start (Docker Compose)
 
```bash
# Clone the repository
git clone <repository-url>
cd <repository-path>
 
# Copy and edit environment variables
cp .env
# Edit .env as needed
 
# Build and start all services
docker-compose up --build
 
# (Optional) Run in detached mode
docker-compose up -d
 
# Stop services
docker-compose down
```
 
--- 
## Environment Setup
 
Example `.env` configuration:
 
```env
NODE_ENV=development
PORT=3000
HOST=0.0.0.0
 
DB_HOST=postgres
DB_PORT=5432
POSTGRES_DB=pa_db
POSTGRES_USER=postgres
POSTGRES_PASSWORD=1234
 
REDIS_HOST=redis
REDIS_PORT=6379
 
JWT_SECRET=your_secret_key
JWT_EXPIRES_IN=24h
 
BCRYPT_SALT_ROUNDS=12
WORKER_CONCURRENCY=3
LOG_LEVEL=debug
 
ADMIN_NAME=Administrator
ADMIN_SURNAME=System
ADMIN_EMAIL=admin@system.com
ADMIN_PASSWORD=AdminPassword123!
 
UPLOAD_DIRECTORY=./uploads
 
INFERENCE_BLACKBOX_HOST=0.0.0.0
INFERENCE_BLACKBOX_PORT=5000
INFERENCE_BLACKBOX_DEBUG=false
INFERENCE_BLACKBOX_UPLOAD_DIR=/usr/src/app/uploads
INFERENCE_BLACKBOX_LOG_LEVEL=INFO
```
 
--- 
## API Documentation
 
All endpoints are JWT-protected unless register and login for user.
 
### User
- `POST /api/users/user` - Register user
- `POST /api/users/login` - Login and get JWT
- `GET /api/users/profile` - Get current user profile
- `GET /api/users/tokens` - Get user's remaining tokens
- `PUT /api/users/:userId` - Update user data
- `DELETE /api/users/:userId` - Delete user
 
### Dataset
- `POST /api/datasets/` - Create dataset (name, tags)
- `POST /api/datasets/data` - Upload image/mask or video/mask to dataset
- `GET /api/datasets/` - List datasets
- `GET /api/datasets/:name` - Get dataset info
- `GET /api/datasets/:name/data` - Get dataset items
- `GET /api/datasets/:name/:type(image|mask)/:filename` - Get image from dataset
- `PUT /api/datasets/:name` - Update dataset
- `DELETE /api/datasets/:name` - Logical deletion of dataset
 
### Inference
- `POST /api/inferences/` - Start inference on dataset
- `GET /api/inferences/job/:jobId/status` - Get job status
- `GET /api/inferences/` - Get all inferences
- `GET /api/inferences/:id` - Get specific inference
- `GET /api/inferences/:id/results` - Get inference result
- `GET /api/inferences/:id/download/:filename"` - Download specific result
 
### Admin
- `GET /api/admin/users/:email/tokens` - Get token balance for user
- `POST /api/admin/user-tokens` - Recharge user tokens
- `GET /api/admin/transactions` - List transactions
- `GET /api/admin/datasets` - List all datasets (optionally include deleted)

       
> **Note:**  
> For routes where you want to view deleted elements as well, simply add the query parameter `?includeDeleted=true` to the route.  
> Pagination is also supported: you can view additional pages by adding `?page=<page_number>` to the route (e.g., `?page=2`).

--- 
## API Routes & Responses

Below are all main API routes, grouped by feature, with example JSON outputs.

 
### User

#### Register
`POST /api/users/user`
```jsonc
{
  "success": true,
  "message": "User created successfully",
  "data": {
    "id": "c4edbda2-2ff1-45de-af20-c615b673508d",
    "name": "Mario",
    "surname": "Rossi",
    "email": "mariorossi@gmail.com",
    "tokens": 100,
    "role" : "user"
  }
}
```

#### Login
`POST /api/users/login`
```jsonc
{
  "success": true,
  "message": "Login successful",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI5OGJhOTY2Yy01OTVhLTRjNzktOWFjMy00Mjg1NDAwYTEyNmEiLCJlbWFpbCI6Im1hcmlvcm9zc2lAZ21haWwuY29tIiwiaWF0IjoxNzU4OTYyOTUzLCJleHAiOjE3NTkwNDkzNTN9.qM2mgQVEJZOcHgtBOgz-pxp6ahaml1xdp-dKWM9OUks",
    "user": {
      "id": "c4edbda2-2ff1-45de-af20-c615b673508d",
      "name": "Mario",
      "email": "mariorossi@gmail.com"
    }
  }
}
```

#### Profile
`GET /api/users/profile`
```jsonc
{
  "success": true,
  "data": {
    "id": "c4edbda2-2ff1-45de-af20-c615b673508d",
    "name": "Mario",
    "surname": "Rossi",
    "email": "mariorossi@gmail.com"
  }
}
```

#### Update User
`PUT /api/users/:userId`
```jsonc
{
  "success": true,
  "message": "User updated successfully",
  "data": {
    /* updated user fields */
  }
}
```

#### Delete User
`DELETE /api/users/:userId`
```jsonc
{
  "success": true,
  "message": "User deleted successfully"
}
```

#### Get Token Balance
`GET /api/users/tokens`
```jsonc
{
  "success": true,
  "message": "Token balance retrieved successfully",
  "data": {
    "balance": 100,
    "recentTransactions": [
      /* ... */
    ],
    "tokenPricing": {
      "dataset_upload": {
        "single_image": 0.65,
        "video_frame": 0.4,
        "zip_file": 0.7
      },
      "inference": {
        "single_image": 2.75,
        "video_frame": 1.5
      }
    }
  }
}
```

---

### Dataset

#### Create Dataset
`POST /api/datasets/`
```jsonc
{
  "success": true,
  "message": "Empty dataset created successfully",
  "dataset": {
    "id": "c4edbdq2-2ff1-45de-af20-c615b673551a",
    "deletedAt": null,
    "userId": "c4edbda2-2ff1-45de-af20-c615b673508d",
    "name": "Inpainting dataset",
    "data": null,
    "tags": ["Inpainting", "Damage", "Mask"],
    "isDeleted": false,
    "nextUploadIndex": 1,
    "updatedAt": "2025-09-27T08:56:59.694Z",
    "createdAt": "2025-09-27T08:56:59.694Z"
  }
}
```

#### Update Dataset
`PUT /api/datasets/:name`
```jsonc
{
  "success": true,
  "message": "Dataset updated succesfully",
  "data": {
    "userId": "c4edbda2-2ff1-45de-af20-c615b673508d",
    "itemCount": 0,
    "changes": {
      "nameChanged": false,
      "tagsChanged": true
    }
  }
}
```

#### Delete Dataset (logical)
`DELETE /api/datasets/:name`
```jsonc
{
  "success": true,
  "message": "Dataset deleted succesfully"
}
```

#### List Datasets
`GET /api/datasets/`
```jsonc
{
  "success": true,
  "message": "Datasets retrieved successfully",
  "data": [
    {
      "userId": "98ba966c-595a-4c79-9ac3-4285400a126a",
      "name": "Inpainting dataset",
      "tags": ["Inpainting", "Damage", "Mask"],
      "createdAt": "2025-09-27T08:56:59.694Z",
      "updatedAt": "2025-09-27T08:56:59.694Z",
      "deletedAt": null,
      "itemCount": 0,
      "type": "empty",
      "isDeleted": false,
      "status": "active"
    }
    /* ...other datasets */
  ]
}
```

#### Get Dataset Items
`GET /api/datasets/:name/data`
```jsonc
{
  "success": true,
  "message": "Dataset data retrieved successfully",
  "data": {
    "name": "Inpainting dataset",
    "type": "image-mask",
    "totalItems": 72,
    "currentPage": 1,
    "totalPages": 8,
    "itemsPerPage": 10,
    "items": [
      {
        "index": 0,
        "imagePath": "datasets/uuid/image1.jpg",
        "maskPath": "datasets/uuid/mask1.png",
        "imageUrl": "http://...image/image1.jpg",
        "maskUrl": "http://...image/mask1.png",
        "frameIndex": null,
        "uploadIndex": 1
      }
      /* ... */
    ]
  }
}
```

#### Upload Data (image/video/zip)
`POST /api/datasets/data`
```jsonc
{
  "message": "Data uploaded and processed successfully",
  "processedItems": 1,
  "tokenSpent": 0.65,
  "userTokens": 99.35,
  "tokenUsage": {
    "tokensSpent": 0.65,
    "remainingBalance": 99.35,
    "operationType": "dataset_upload"
  }
}
```

---

### Inference

#### Start Inference
`POST /api/inferences/`
```jsonc
{
  "success": true,
  "message": "Inference created and queued successfully",
  "inference": {
    "id": "c4edbda2-2ff1-45de-af20-c615b673508d",
    "status": "PENDING",
    "modelId": "default_inpainting",
    "datasetName": "Inpainting dataset",
    "createdAt": "2025-09-27T09:12:15.908Z"
  },
  "jobId": 1
}
```

#### Get Inference Status
`GET /api/inferences/job/:jobid/status`
```jsonc
{
  "success": true,
  "message": "Job status retrieved successfully",
  "data": {
    "jobId": "1",
    "status": "COMPLETED", /* or PENDING, FAILED, ABORTED, RUNNING */
    "progress": 100,
    "result": {
      /* ... */
    }
  }
  /* ... */
}
```

#### Get Inference Result
`GET /api/inferences/:id/results`
```jsonc
{
  "success": true,
  "message": "Inference results retrieved successfully",
  "data": {
    "inferenceId": "c4edbda2-2ff1-45de-af20-c615b673508d",
    "status": "COMPLETED",
    "images": [
      {
        "originalPath": "datasets/uuid/image1.jpg",
        "outputPath": "inferences/uuid/processed_image1.png",
        "downloadUrl": "http://..."
      }
      /* ... */
    ],
    "videos": [
      {
        "originalVideoId": "1",
        "outputPath": "inferences/uuid/video_1.mp4",
        "downloadUrl": "http://..."
      }
      /* ... */
    ]
  }
}
```

---

### Admin

#### Recharge User Tokens
`POST /api/admin/user-tokens`
```jsonc
{
  "success": true,
  "message": "Tokens recharged succesfully",
  "data": {
    "userEmail": "mariorossi@gmail.com",
    "amountAdded": 200,
    "newBalance": 300
  }
}
```

#### Get User Token Balance
`GET /api/admin/users/:email/tokens`
```jsonc
{
  "success": true,
  "message": "User token information retrieved successfully",
  "data": {
    "id": "c4edbda2-2ff1-45de-af20-c615b673508d",
    "name": "Mario",
    "surname": "Rossi",
    "email": "mariorossi@fmail.com",
    "currentBalance": 300,
    "role": "user"
  },
  "transactions": [
    {
      "id": "8e897a50-d8f8-4e07-83f1-651cd17a007c",
      "operationType": "admin_recharge",
      "operationId": "admin_recharge_e7e834a2-931e-405f-b674-8478b300323c_1758964794928",
      "amount": 200,
      "description": "Admin recharge by admin@system.com: +200 tokens",
      "createdAt": "2025-09-27T09:19:54.929Z"
    }
    /* ... */
  ]
}
```

#### List Transactions
`GET /api/admin/transactions`
```jsonc
{
  "success": true,
  "message": "All transactions retrieved successfully",
  "data": {
    "transactions": [
      {
        "id": "c4edbda2-2ff1-45de-af20-c615b673508d",
        "operationType": "admin_recharge",
        "operationId": "admin_recharge_850849ab-dfe8-4882-8c18-36df30aac669_1758621495751",
        "amount": 200,
        "description": "Admin recharge by admin@system.com: +1000 tokens",
        "createdAt": "2025-09-23T09:58:15.751Z",
        "user": {
          /* ... */
        }
      }
      /* ... */
    ]
  }
}
```

#### List All Datasets (admin)
`GET /api/admin/datasets`
```jsonc
{
  "success": true,
  "message": "All datasets retrieved successfully",
  "data": {
    "datasets": [
      {
        "id": "uuid",
        "name": "Inpainting dataset",
        "tags": ["Inpainting", "Damage", "Mask"],
        "datasetType": "image-mask",
        "itemCount": 72,
        "estimatedInferenceCost": 109.25
        /* ... */
      }
      /* ... */
    ]
    /* ... */
  }
}
```
--- 
## Postman Collection for API Testing

A comprehensive Postman collection is provided to test all backend functionalities. You can import both the collection and the corresponding environment directly into Postman.

Operations are grouped into four main sections:
- **User**
- **Dataset**
- **Inference**
- **Admin**

Each group contains all requests needed to cover typical usage and administration flows.

> **Note:**  
> If you run the entire collection in bulk, some tests may fail due to the order of operations (for example, deleting a user or dataset may prevent subsequent tests from working).  
> A recommended configuration is to move the "Delete Dataset" and "Delete User" requests to the end of the collection.  
> In other cases, you must correctly insert dynamic data into the routes, using values obtained from previous operations.

To view the images or results uploaded to a dataset, use the URLs provided in the relevant API responses (e.g., imageUrl, maskUrl, downloadUrl).

When testing inference, you may encounter errors when viewing results if the inference process is still running or pending. Wait for the job to complete before accessing the results.

It is recommended to execute requests sequentially and update dynamic parameters as needed to ensure successful testing.

The collection and environment files are included in the repository at  
[`postman_collection/Inpainting API.postman_collection.json`](postman_collection/Inpainting%20API.postman_collection.json).

Additionally, the project includes a [`imageForTest.zip`](public/imageForTest/imageForTest.zip) folder containing sample images, videos, and masks that can be used for testing the API endpoints.

--- 
## Database Structure
 
The application uses PostgreSQL with the following tables:
 
- **Users**: Stores user account information, authentication credentials, token balance, and user roles.
- **Datasets**: Contains metadata and data references for uploaded datasets, including images, videos, tags, and logical deletion status.
- **Inferences**: Tracks inference jobs, their status, parameters, results, and associations to users and datasets.
- **Token_transactions**: Records all token-related operations for audit purposes, including recharges, deductions, and transaction details.
 
![Database Structure](public/Database.png)
 
--- 
### Table Fields
 
#### **Users**
| Field         | Type                | Description                                      |
|---------------|---------------------|--------------------------------------------------|
| id            | UUID                | Unique user identifier                           |
| name          | VARCHAR(100)        | User's first name                                |
| surname       | VARCHAR(100)        | User's last name                                 |
| email         | VARCHAR(255)        | User's email address (unique)                    |
| password      | VARCHAR(255)        | Hashed password                                  |
| tokens        | DECIMAL(10,2)       | Current token/credit balance                     |
| role          | user_role (enum)    | User role: 'user' or 'admin'                     |
| created_at    | TIMESTAMP           | Account creation timestamp                       |
| updated_at    | TIMESTAMP           | Last update timestamp                            |
 
#### **Datasets**
| Field             | Type           | Description                                                    |
|-------------------|----------------|----------------------------------------------------------------|
| id                | UUID           | Unique dataset identifier                                      |
| user_id           | UUID           | Reference to owner user (nullable)                             |
| name              | VARCHAR(255)   | Dataset name                                                   |
| data              | JSONB          | JSON containing image-mask pairs or video frame-mask lists     |
| tags              | TEXT[]         | Array of tags for categorization                               |
| is_deleted        | BOOLEAN        | Logical deletion flag                                          |
| next_upload_index | INTEGER        | Tracks next upload index for incremental uploads               |
| created_at        | TIMESTAMP      | Dataset creation timestamp                                     |
| updated_at        | TIMESTAMP      | Last update timestamp                                          |
| deleted_at        | TIMESTAMP      | Dataset elimination timestamp                                  |
 
#### **Inferences**
| Field        | Type              | Description                                         |
|--------------|-------------------|-----------------------------------------------------|
| id           | UUID              | Unique inference identifier                         |
| status       | inference_status  | Job status: 'PENDING', 'RUNNING', etc.              |
| model_id     | VARCHAR(255)      | Model used for inference                            |
| parameters   | JSONB             | Inference parameters (e.g., Grad-Cam settings)      |
| result       | JSONB             | Output/result of the inference                      |
| dataset_id   | UUID              | Reference to the associated dataset                 |
| user_id      | UUID              | Reference to the user who started the inference     |
| created_at   | TIMESTAMP         | Inference creation timestamp                        |
| updated_at   | TIMESTAMP         | Last update timestamp                               |
 
#### **Token_transactions**
| Field           | Type            | Description                                         |
|-----------------|-----------------|-----------------------------------------------------|
| id              | UUID            | Unique transaction identifier                       |
| user_id         | UUID            | Reference to the user involved                      |
| operation_type  | VARCHAR(50)     | Type of operation (e.g., recharge, deduction)       |
| operation_id    | VARCHAR(255)    | Related operation/job identifier (optional)         |
| amount          | DECIMAL(10,2)   | Amount of tokens changed                            |
| balance_before  | DECIMAL(10,2)   | User's token balance before the transaction         |
| balance_after   | DECIMAL(10,2)   | User's token balance after the transaction          |
| status          | VARCHAR(20)     | Transaction status (e.g., completed)                |
| description     | TEXT            | Additional details or notes                         |
| created_at      | TIMESTAMP       | Transaction creation timestamp                      |
 
--- 
 
## System Architecture
The system architecture implements the following schema.
 
```plaintext
                   +---------------------------+
                   |      Client (User)        |
                   +-------------^-------------+
                                 | (HTTP/S Request)
                   +-------------v-------------+
                   |    Router (Express.js)    |
                   +-------------^-------------+
                                 | (next())
                   +-------------v-------------+
                   |     Middleware Layer      |
                   |---------------------------|
                   | 1. Security (Helmet)      |
                   | 2. CORS                   |
                   | 3. Auth (JWT Middleware)  |
                   | 4. Input Validation       |
                   | 5. File Upload (Multer)   |
                   +-------------^-------------+
                                 | (next())
                   +-------------v-------------+
                   |      Controller Layer     |
                   |---------------------------|
                   | - Handles HTTP requests   |
                   | - Formats response        |
                   +-------------^-------------+
                                 | (method call)
                   +-------------v-------------+
                   |       Service Layer       |
                   |---------------------------|
                   | - Business logic          |
                   | - Orchestrates Repo/Proxy |
                   | - Calls TokenService      |
                   +-------------^-------------+
                                 | (uses)
+--------------------------------+--------------------------------+
|          Proxy Layer           |        Repository Layer        |
|--------------------------------|--------------------------------|
| - Interface for Job Queue      | - Abstracts DB operations      |
+-----------------^--------------+----------------^---------------+
                  | (addJob)                       | (find, create)
+-----------------v--------------+----------------v---------------+
|         Queue System           |         DAO Layer              |
|--------------------------------|--------------------------------|
| - Adds jobs to Redis           | - Executes Sequelize queries   |
+-----------------^--------------+----------------^---------------+
                  | (Persist job)                 | (Executes query)
+-----------------v--------------+----------------v---------------+
|        Infrastructure          |       Models (Sequelize)       |
|--------------------------------|--------------------------------|
|       (Redis)                  | - Map tables to objects        |
+--------------------------------+----------------^---------------+
                                                  | (uses connection)
                                  +---------------v----------------+
                                  |     Database (PostgreSQL)      |
                                  +--------------------------------+
 
 
- **Router**: Maps HTTP routes to controllers.
- **Controller**: Handles request logic, validation, error handling.
- **Middleware**: Auth, rate limiting, file upload, logging.
- **Proxy**: Intercepts requests, validates, queues jobs.
- **Queue**: Bull job management.
- **Worker**: Background job processor.
- **Service**: Core business logic (e.g., image processing).
- **Repository**: Data access abstraction.
- **DAO**: Direct database operations.
- **Model**: Entity definitions.
```
 
## Inference Workflow (Worker + External Service)
The Inference Workflow implements the following schema.
 
```plaintext
+--------------------------------+
|         Queue System           |
|--------------------------------|
|       (Redis / Bull)           |
+-----------------^--------------+
                  | (Fetch Job)
+-----------------v--------------+
|       Worker Process           |
|--------------------------------|
| - Executes job logic           |
+-----------------^--------------+
                  | (Calls)
+-----------------v--------------+
|        Adapter Layer           |
|--------------------------------|
| - Translates the request       |
| - Handles HTTP call            |
+-----------------^--------------+
                  | (HTTP Request)
+-----------------v--------------+
|   External Service (Python)    |
|--------------------------------|
| - Flask, OpenCV                |
| - Runs inference               |
+-----------------^--------------+
                  | (HTTP Response)
+-----------------v--------------+
|        Adapter Layer           |
|--------------------------------|
| - Receives & formats response  |
+-----------------^--------------+
                  | (Returns result)
+-----------------v--------------+
|       Worker Process           |
|--------------------------------|
| - Updates DB via Repository    |
| - Confirms/Refunds Tokens      |
+--------------------------------+
 
- **Queue**: Stores inference jobs asynchronously (Redis + Bull).  
- **Worker**: Processes jobs in the background.  
- **Adapter**: Translates requests and responses, handles HTTP calls to the external service.  
- **External Service**: Python microservice (Flask + OpenCV) that executes inference.  
- **Repository**: Persists job results and state updates to the database.  
- **Token Service**: Confirms or refunds tokens depending on job success.  
```
--- 
## Patterns
 
This project extensively uses classic patterns to ensure a **robust, maintainable, and scalable architecture**. Below are the main patterns used, with their purpose and rationale.
 
--- 
 
### 1. Singleton
**Purpose:** Ensures a class has only one instance and provides a global access point.  
**Why used:** Ideal for shared resources or services that maintain global state, avoiding multiple instances.  
**Example usage:**  
- `DbConnection`: single database connection pool  
- `InferenceQueue`: single Redis connection  
- All DAOs, Repositories, Services, Proxies, and Adapter  
 
```typescript
 
// src/services/TokenService.ts
export class TokenService {
  private static instance: TokenService;
  private constructor() { /* ... initialization of repositories, etc. ... */ }
 
  public static getInstance(): TokenService {
    if (!TokenService.instance) {
      TokenService.instance = new TokenService();
    }
    return TokenService.instance;
  }
}
```
 
--- 
 
### 2. Factory Method
**Purpose:** Defines an interface for creating objects but lets subclasses decide which concrete class to instantiate.  
**Why used:** Centralizes creation of complex objects (e.g., error messages, loggers) and decouples client code from specific creation logic.  
**Example usage:**    
- `LoggerFactory`: Creates specialized loggers for different domains  
 
```typescript
// src/factory/loggerFactory.ts
export class LoggerFactory {
  // ... (Singleton implementation) ...
 
  // This method is a "factory method" that creates a specific type of logger.
  public createDatasetLogger(wrappedLogger?: LoggerDecorator): DatasetRouteLogger {
        return new DatasetRouteLogger(wrappedLogger);
    }
}
```
--- 
 
### 3. DAO & Repository
**Purpose:** Separates database access logic into two layers:  
- DAO: Executes direct queries (technical layer)  
- Repository: Provides a clean, domain-oriented interface, orchestrates DAO calls  
**Why used:** Clear separation of business logic and persistence  
**Example usage:**  
- DAO: `UserDao`, `DatasetDao`, `InferenceDao`, `TransactionDao`  
- Repository: `UserRepository`, `DatasetRepository`, `InferenceRepository`, `TransactionRepository`  
 
```typescript
// src/dao/DatasetDao.ts
export class DatasetDao {
  public async findWithUsers(filters: DatasetFilters, pagination: PaginationOptions) {
    // The DAO is the only layer that builds and executes a complex Sequelize query.
    return await Dataset.findAndCountAll({
      where: { ...filters },
      include: [{ model: User, as: "user" }],
      // ... other query options
    });
  }
}
```
 
```typescript
 
// src/repository/DatasetRepository.ts
export class DatasetRepository {
  private readonly datasetDao: DatasetDao;
  // ...
  public async findDatasetsWithUsers(filters: DatasetFilters, pagination: PaginationOptions) {
    // The repository provides a clean API and simply delegates the data access call to the DAO.
    return await this.datasetDao.findWithUsers(filters, pagination);
  }
}
```
--- 
 
### 4. Chain of Responsibility
**Purpose:** Passes a request along a chain of handlers; each decides whether to process or forward it.  
**Why used:** Flexible and decoupled pipeline for request processing, validation, or error handling  
**Example usage:**  
- `errorHandler.ts`  
- `auth.middleware.ts`: authenticateToken chain  
 
```typescript
// src/middleware/errorHandler.ts
function logErrors(err, req, res, next) {
  // Responsibility: Log the error.
  errorLogger.log(/* ... */);
  next(err); // Pass to the next handler in the chain.
}
 
function formatErrorResponse(err, req, res, next) {
  // Responsibility: Ensure the error has a standard format.
  // ...
  next(err); // Pass to the final handler.
}
 
export const errorHandlingChain = [logErrors, formatErrorResponse, /*...*/];
```
--- 
 
### 5. Proxy
**Purpose:** Provides a surrogate to control access to another object.  
**Why used:** Intercepts calls to the real object, adding functionality before or after delegating  
**Example usage:**  
- `InferenceBlackBoxProxy`: intermediates between Controllers/Services and InferenceQueue  
 
```typescript
// src/proxy/inferenceBlackBoxProxy.ts
export class InferenceBlackBoxProxy {
  private readonly inferenceQueue: InferenceQueue;
  // ...
  public async processDataset(...) {
    // 1. Adds functionality (validation)
    this.validateJobData(...);
    // 2. Delegates the call to the real object (the queue)
    const job = await this.inferenceQueue.addInferenceJob(...);
    return job.id?.toString();
  }
}
```
--- 
 
### 6. Adapter
**Purpose:** Converts one interface into another expected by the client.  
**Why used:** Integrates external components without changing existing code  
**Example usage:**  
- `InferenceBlackBoxAdapter`: Bridges Node.js/TypeScript and Python/Flask inference service  
 
```typescript
// src/services/inferenceBlackBoxAdapter.ts
export class InferenceBlackBoxAdapter {
  private readonly pythonServiceUrl: string;
  // ...
  async processDataset(userId: string, datasetData: object, parameters: object) {
    // 1. Adapts the method call into an HTTP request payload.
    const request: ProcessingRequest = { userId, data: datasetData, parameters };
    // 2. Uses Axios to communicate via a different protocol (HTTP).
    const response = await axios.post(`${this.pythonServiceUrl}/process-dataset`, request);
    // 3. Adapts the HTTP response back into an object the application expects.
    return response.data;
  }
}
```
--- 
### 7. Decorator 
**Purpose:** Dynamically adds functionality to an object without altering its structure.  
**Why used:** Provides structured, domain-specific logging instead of a generic logger  
**Example usage:**  
- `loggerDecorator.ts`: `UserRouteLogger`, `DatasetRouteLogger` extending a base logger with specialized logging methods  
 
```typescript
// src/utils/loggerDecorator.ts
export interface LoggerDecorator {
    log(message: string, data?: LogData): void;
}

// Base Logger Decorator 
export abstract class BaseLoggerDecorator implements LoggerDecorator {
    protected logger: winston.Logger;
    // Accept an optional wrapped logger for chaining decorators
    constructor(protected wrappedLogger?: LoggerDecorator) {
        this.logger = Logger.getInstance();
    }
}
 
export class DatasetRouteLogger extends BaseLoggerDecorator {
  // Adds new, specialized functionality
  logDatasetCreation(userId: string, datasetName: string, type?: string): void {
        this.log("DATASET_CREATED", { userId, datasetName, datasetType: type });
  }
}
```
--- 
 
### 8. MVC (Model-View-Controller) for APIs
**Purpose:** Separates application logic into three components:  
- Model: Data and business logic  
- View: Representation of data (JSON in APIs)  
- Controller: Handles input, orchestrates Model & View  
**Why used:** Fundamental for organizing the backend and ensuring separation of concerns  
**Example usage:**  
- `UserController`, `DatasetController`, `InferenceController`  
 
```typescript
// src/controllers/DatasetController.ts
export class DatasetController {
  static async createEmptyDataset(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      // 1. CONTROLLER receives HTTP input (req.body, req.user)
      const { name, tags } = req.body;
      const userId = req.user!.userId;
 
      // 2. CONTROLLER interacts with the MODEL (via the Service)
      const dataset = await DatasetService.createEmptyDataset(userId, name, tags);
     
      // 3. CONTROLLER prepares the VIEW (the JSON response)
      res.status(201).json({
        message: "Empty dataset created successfully",
        dataset: dataset.toJSON()
      });
    } catch (error) {
      next(error); // Delegates errors
    }
  }
}
```
--- 
 
### 9. Middleware
**Purpose:** Chain of reusable functions that handle HTTP requests.  
**Why used:** Decomposes request handling into isolated, reusable steps (authentication, validation, logging, etc.)  
**Example usage:**  
- `auth.middleware.ts`, `validation.middleware.ts`, `dataset.middleware.ts`, `errorHandler.ts`  
 
```typescript
// src/routes/datasetRoutes.ts (example)
// To create a dataset, the request must pass through two middleware functions
// BEFORE reaching the final controller logic.
router.post("/", 
    ...authenticateToken, 
    ...validateDatasetCreation,
    DatasetController.createEmptyDataset
);
```
--- 
 
## Diagrams
 
### Actor Diagram
![Actor](public/actorUML.png)
 
### Use Cases
![Use Case](public/useCase.png)
 
---
## Sequence Diagrams
 
### Login for a user
This diagram illustrate how a user authenticates with email and password.
![Login](public/sdLogin.png)
### Recharge user token by admin
This diagram models a privileged, administrator-only operation (recharge user token), highlighting the authorization checks involved.
![Recharge token](public/sdRechargetokenadmin.png)
### JWT token validation
This diagram details the process of verifying a JSON Web Token (JWT) for a protected API route. It covers the entire authenticateToken middleware chain.
 
![JWT Token validation](public/sdjwttokenvalidation.png)
### Upload data in a dataset
This diagram details the workflow of uploading data to a dataset.
![Upload data](public/sdUploaddata.png)
### Inference creation
This diagram illustrate the workflow for the creation of an inference operation.
![Create inference](public/sdCreateinference.png)
 
---
 
## Testing
 
The project includes a comprehensive suite of unit tests written with Jest, focusing on middleware and core business logic. External dependencies (database, libraries) are extensively mocked for fast and reliable tests. The main areas covered are:
 
- **Authentication Middleware**
  - Token presence and format
  - JWT signature and expiration
  - User existence in DB
  - Authorization logic
 
- **User Input Validation Middleware**
  - Required fields
  - Data formatting (email, name)
  - Password strength
  - Data sanitization
  - UUID format
 
- **Inference Request Validation Middleware**
  - Inference creation payload
  - Resource access (ID format)
 
Run tests with:
- **Unit/Integration Tests**: `npm test`
 
---
 
## Linting & Code Quality
 
The project uses **ESLint** to enforce consistent code style and catch common programming errors. Run lint checks with:

```bash
npm run lint
```

For the Python-based BlackBox inference service, **pylint** is used to ensure code quality and style consistency:

```bash
pylint src/services/inferenceBlackBox.py
```

In addition, **SonarQube** is used to detect code smells and maintain high code quality.

---
