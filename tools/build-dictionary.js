#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function buildDictionary(templateDb) {
  const templates = Array.isArray(templateDb.templates) ? templateDb.templates : [];
  const dictionary = {};
  const reverseDictionary = {};

  templates.forEach((template, index) => {
    const symbolId = index + 1;
    const name = String(template.name || `template_${symbolId}`);
    dictionary[name] = symbolId;
    reverseDictionary[String(symbolId)] = name;
  });

  return {
    schema: "schemzip.dictionary-db",
    schemaVersion: 1,
    libraryId: templateDb.library_id || "analog",
    libraryVersion: templateDb.library_version || "1.0.0",
    libraryHash: templateDb.source_hash || "",
    symbolCount: templates.length,
    dictionary,
    reverseDictionary,
  };
}

function main(argv) {
  const inputPath = path.resolve(argv[2] || "template_db.json");
  const outDir = path.resolve(argv[3] || path.dirname(inputPath));
  const templateDb = readJson(inputPath);
  const data = buildDictionary(templateDb);

  fs.mkdirSync(outDir, { recursive: true });
  writeJson(path.join(outDir, "dictionary.json"), data);
  writeJson(
    path.join(outDir, "reverse_dictionary.json"),
    {
      schema: data.schema,
      schemaVersion: data.schemaVersion,
      libraryId: data.libraryId,
      libraryVersion: data.libraryVersion,
      libraryHash: data.libraryHash,
      symbolCount: data.symbolCount,
      reverseDictionary: data.reverseDictionary,
    }
  );
  console.log(JSON.stringify({
    dictionary: path.join(outDir, "dictionary.json"),
    reverseDictionary: path.join(outDir, "reverse_dictionary.json"),
    libraryId: data.libraryId,
    libraryVersion: data.libraryVersion,
    symbolCount: data.symbolCount,
  }));
}

if (require.main === module) {
  main(process.argv);
}
