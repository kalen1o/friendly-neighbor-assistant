"use client";

import { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Upload } from "lucide-react";

interface DocumentUploadProps {
  onUpload: (files: File[]) => void;
  disabled?: boolean;
}

export function DocumentUpload({ onUpload, disabled }: DocumentUploadProps) {
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (!disabled && acceptedFiles.length > 0) {
        onUpload(acceptedFiles);
      }
    },
    [onUpload, disabled]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    disabled,
    accept: {
      "text/plain": [".txt", ".md", ".csv"],
      "application/pdf": [".pdf"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
      "text/html": [".html"],
    },
  });

  return (
    <div
      {...getRootProps()}
      className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors ${
        isDragActive
          ? "border-primary bg-primary/5"
          : "border-muted-foreground/25 hover:border-primary/50"
      } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
    >
      <input {...getInputProps()} />
      <Upload className="mb-3 h-8 w-8 text-muted-foreground" />
      {isDragActive ? (
        <p className="text-sm text-primary">Drop files here...</p>
      ) : (
        <>
          <p className="text-sm font-medium">Drop files here or click to upload</p>
          <p className="mt-1 text-xs text-muted-foreground">
            PDF, DOCX, TXT, MD, HTML, CSV (max 50MB)
          </p>
        </>
      )}
    </div>
  );
}
