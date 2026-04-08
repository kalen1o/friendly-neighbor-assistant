"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DocumentUpload } from "@/components/document-upload";
import { DocumentList } from "@/components/document-list";
import {
  deleteDocument,
  getDocumentStatus,
  listDocuments,
  uploadDocument,
  type DocumentOut,
} from "@/lib/api";

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentOut[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const fetchDocuments = useCallback(async () => {
    try {
      const docs = await listDocuments();
      setDocuments(docs);
      return docs;
    } catch (e) {
      console.error("Failed to fetch documents:", e);
      return [];
    }
  }, []);

  // Poll for processing documents
  useEffect(() => {
    fetchDocuments();

    pollingRef.current = setInterval(async () => {
      const docs = await fetchDocuments();
      const hasProcessing = docs.some((d) => d.status === "processing");
      if (!hasProcessing && pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    }, 2000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [fetchDocuments]);

  const handleUpload = async (files: File[]) => {
    setUploading(true);
    setError(null);

    try {
      for (const file of files) {
        await uploadDocument(file);
      }
      await fetchDocuments();

      // Start polling if not already
      if (!pollingRef.current) {
        pollingRef.current = setInterval(async () => {
          const docs = await fetchDocuments();
          const hasProcessing = docs.some((d) => d.status === "processing");
          if (!hasProcessing && pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
        }, 2000);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (docId: number) => {
    try {
      await deleteDocument(docId);
      await fetchDocuments();
    } catch (e) {
      console.error("Failed to delete document:", e);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <h1 className="text-2xl font-semibold">Knowledge Base</h1>

        {error && (
          <div className="rounded-lg bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <DocumentUpload onUpload={handleUpload} disabled={uploading} />
        <DocumentList documents={documents} onDelete={handleDelete} />
      </div>
    </div>
  );
}
