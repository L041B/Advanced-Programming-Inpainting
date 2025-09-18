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
    tokens DECIMAL(10,2) NOT NULL DEFAULT 100.00, -- Token balance with 2 decimal places
    role user_role NOT NULL DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create status enum type
DO $$ BEGIN
    CREATE TYPE execution_status AS ENUM ('pending', 'processing', 'completed', 'failed');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create executions table with UUID
CREATE TABLE IF NOT EXISTS executions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    original_image BYTEA NOT NULL,
    mask_image BYTEA NOT NULL,
    output_image BYTEA,
    status execution_status NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create inference status enum type (updated with ABORTED status)
DO $$ BEGIN
    CREATE TYPE inference_status AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'ABORTED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create token transactions table for audit trail
CREATE TABLE IF NOT EXISTS token_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    operation_type VARCHAR(50) NOT NULL, -- 'dataset_upload', 'inference', 'admin_recharge', 'refund'
    operation_id VARCHAR(255), -- Reference to dataset name, inference id, etc.
    amount DECIMAL(10,2) NOT NULL, -- Positive for recharge, negative for usage
    balance_before DECIMAL(10,2) NOT NULL,
    balance_after DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'completed', -- 'pending', 'completed', 'refunded'
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create datasets table
CREATE TABLE IF NOT EXISTS datasets (
    user_id UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    data JSONB, -- Contains image-mask pairs or frame-mask lists for videos, can be empty
    tags TEXT[] DEFAULT '{}', -- Array of strings for tags
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    next_upload_index INTEGER DEFAULT 1, -- Tracks the next upload index for this dataset
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, name),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Create inferences table
CREATE TABLE IF NOT EXISTS inferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    status inference_status NOT NULL DEFAULT 'PENDING',
    model_id VARCHAR(255) NOT NULL,
    parameters JSONB, -- JSON for Grad-Cam, etc.
    result JSONB, -- JSON with inference output
    dataset_name VARCHAR(255) NOT NULL,
    user_id UUID NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id, dataset_name) REFERENCES datasets(user_id, name) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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

DROP TRIGGER IF EXISTS update_executions_updated_at ON executions;
CREATE TRIGGER update_executions_updated_at
    BEFORE UPDATE ON executions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();


DROP TRIGGER IF EXISTS update_datasets_updated_at ON datasets;
CREATE TRIGGER update_datasets_updated_at
    BEFORE UPDATE ON datasets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_inferences_updated_at ON inferences;
CREATE TRIGGER update_inferences_updated_at
    BEFORE UPDATE ON inferences
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_executions_user_id ON executions(user_id);
CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status);
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
CREATE INDEX IF NOT EXISTS idx_inferences_dataset ON inferences(user_id, dataset_name);

-- Note: Admin user will be created programmatically from environment variables
-- This ensures no sensitive data is exposed in SQL files
