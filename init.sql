-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create role enum type
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('user', 'admin');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create users table with UUID, tokens, and roles
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    surname VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    tokens DECIMAL(10,2) NOT NULL DEFAULT 100.00, 
    role user_role NOT NULL DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- Create inference status enum type
DO $$ BEGIN
    CREATE TYPE inference_status AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'ABORTED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create token transactions table for audit trail
CREATE TABLE IF NOT EXISTS token_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    operation_type VARCHAR(50) NOT NULL, 
    operation_id VARCHAR(255),
    amount DECIMAL(10,2) NOT NULL, 
    balance_before DECIMAL(10,2) NOT NULL,
    balance_after DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'completed', 
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create datasets table with UUID primary key
CREATE TABLE IF NOT EXISTS datasets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID,  
    name VARCHAR(255) NOT NULL,
    data JSONB, -- Contains image-mask pairs or frame-mask lists for videos, can be empty
    tags TEXT[] DEFAULT '{}', -- Array of strings for tags
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    next_upload_index INTEGER DEFAULT 1, -- Tracks the next upload index for this dataset
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Create partial unique index that excludes NULL user_id values
CREATE UNIQUE INDEX IF NOT EXISTS idx_datasets_user_name_unique 
ON datasets (user_id, name) 
WHERE user_id IS NOT NULL;

-- Create inferences table 
CREATE TABLE IF NOT EXISTS inferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    status inference_status NOT NULL DEFAULT 'PENDING',
    model_id VARCHAR(255) NOT NULL,
    parameters JSONB, -- JSON for Grad-Cam, etc.
    result JSONB, -- JSON with inference output
    dataset_id UUID NOT NULL, -- Torna a dataset_id UUID  
    user_id UUID NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (dataset_id) REFERENCES datasets(id) ON DELETE SET NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for automatic updated_at updates
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create trigger for datasets table
DROP TRIGGER IF EXISTS update_datasets_updated_at ON datasets;
CREATE TRIGGER update_datasets_updated_at
    BEFORE UPDATE ON datasets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create trigger for inferences table
DROP TRIGGER IF EXISTS update_inferences_updated_at ON inferences;
CREATE TRIGGER update_inferences_updated_at
    BEFORE UPDATE ON inferences
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_name_surname ON users(name, surname);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_tokens ON users(tokens);
CREATE INDEX IF NOT EXISTS idx_token_transactions_user_id ON token_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_token_transactions_operation ON token_transactions(operation_type, operation_id);
CREATE INDEX IF NOT EXISTS idx_datasets_user_id ON datasets(user_id);
CREATE INDEX IF NOT EXISTS idx_datasets_tags ON datasets USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_datasets_is_deleted ON datasets(is_deleted);
CREATE INDEX IF NOT EXISTS idx_datasets_next_upload_index ON datasets(next_upload_index);
CREATE INDEX IF NOT EXISTS idx_inferences_user_id ON inferences(user_id);
CREATE INDEX IF NOT EXISTS idx_inferences_status ON inferences(status);
CREATE INDEX IF NOT EXISTS idx_inferences_model_id ON inferences(model_id);
CREATE INDEX IF NOT EXISTS idx_inferences_dataset_id ON inferences(dataset_id); -- Torna a dataset_id
CREATE INDEX IF NOT EXISTS idx_token_transactions_status ON token_transactions(status);

