-- CreateTable
CREATE TABLE "PolizyTuple" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "condition" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "content" TEXT
);

-- CreateTable
CREATE TABLE "Folder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "PolizyTuple_subjectType_subjectId_relation_idx" ON "PolizyTuple"("subjectType", "subjectId", "relation");

-- CreateIndex
CREATE INDEX "PolizyTuple_objectType_objectId_relation_idx" ON "PolizyTuple"("objectType", "objectId", "relation");

-- CreateIndex
CREATE UNIQUE INDEX "PolizyTuple_subjectType_subjectId_relation_objectType_objectId_key" ON "PolizyTuple"("subjectType", "subjectId", "relation", "objectType", "objectId");
