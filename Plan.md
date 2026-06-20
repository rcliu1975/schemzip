# AICOMP Development Plan

# Goal

Develop a compressor/decompressor for draw.io analog schematics.

The compressor shall:

* Automatically recognize flattened symbols inside drawio files.
* Use Analog.xml as a symbol template database.
* Replace repeated symbol geometries with compact references.
* Support lossless decompression back to drawio format.
* Continuously improve recognition accuracy using an expanding corpus.
* 程式要有版本資訊,可以隨時確認.
* 壓縮後的檔案需要有程式版號資訊,以便解壓時可以確認解壓縮程式的一致性.

---

# Architecture


.drawio

↓

Parser

↓

Graph Builder

↓

Template Matcher

↓

Instances


↓

Serializer


↓

.aic




.aic

↓

Deserializer

↓

Instance Expander

↓

drawio Generator

↓

.drawio



---

# Phase 1

Stencil Database



Input

Analog.xml



Output


StencilTemplate


class StencilTemplate:

    name:str

    width:float

    height:float

    vertices:list

    edges:list



Tasks


- [x] Parse mxlibrary

- [x] Extract all symbols

- [x] Normalize coordinates

- [x] Store canonical representation

- [x] Generate template database





Example



NMOS


nodes

[(8,4),
 (8,28),
 (14,8),
 (14,24)]


edges

[(0,1),
 (2,3)]




Deliverables


parse_library.py


template_db.pkl


template_db.json



---


# Phase 2


Drawio Parser



Input


*.drawio



Output


CellGraph




Tasks



- [x] Parse mxGraphModel


- [x] Build connectivity graph


- [x] Find connected components


- [x] Calculate bounding boxes


- [x] Normalize coordinates

Validated on `drawio_samples/AnlogIC.drawio`: 39 mxCells, 6 connected components.





Example




39 mxCells


↓

6 connected components


↓

candidate #0


candidate #1


candidate #2





Deliverables



parse_drawio.py


graph_builder.py



---


# Phase 3


Template Matching




Goal


Recognize flattened symbols




Input


candidate component



Output


NMOS


PMOS


res


cap




Method



Step1


Compare object count




Step2


Compare edge topology




Step3


Normalize coordinates




Step4


Rigid transform matching




translation


rotation


mirror




Step5


Tolerance matching




distance < 0.5 pixel




Similarity score



0~100




Acceptance


score >95





Pseudo




match(candidate):


for template in db:


if topology mismatch:


continue


for transform in transforms:


score=compare()


if score>best:


best=score





Deliverables


- [x] matcher.py
- [ ] matcher_test.py




---


# Phase 4


Compression




Output format


AIC1




Header



magic


AIC1



version


1



library_hash


uint64



object_count


uint32





Instance



type_id


uint16



x


uint16



y


uint16



rotation


uint8



mirror


uint8



text_id


uint16






Deliverables


- [x] compress_aic.py
- [x] restore_aic.py

Validated on `drawio_samples/AnlogIC.drawio`: AIC archive 1.5K, restored drawio 16K, 39 mxCells preserved.




Example




NMOS

120

220

R90




res

180

260

R0




cap

200

300





---


# Phase 5


Decompression




Input


AIC1




Output


drawio




Process



Load Analog.xml


Lookup stencil


Instantiate geometry


Apply transform


Assign mxCell ids


Generate XML





Deliverables



decompress.py




decompress_drawio.py





---


# Phase 6


Regression Corpus




Directory




libraries/

    Analog.xml


drawio_samples/




amp001.drawio


amp002.drawio


lna01.drawio


mixer03.drawio


pll02.drawio





compressed/




tests/




expected/




metrics/






Metrics




recognition rate


compression ratio


false positive count


runtime






Example




recognized


37/39




94.8%




compression


16390 bytes


→


472 bytes




34.7x






---


# Phase 7


Continuous Improvement




Analog.xml grows over time




New drawio files become test cases




Unknown symbols detected




Export candidate templates




review/


unknown_001.drawio


unknown_002.drawio





Human confirms




Append into Analog.xml




Rebuild database




Run regression





---


# Phase 8


CLI




aicomp build-db Analog.xml


aicomp compress xxx.drawio


aicomp decompress xxx.aic


aicomp benchmark


aicomp test





Examples




aicomp compress OTA.drawio



OTA.aic




aicomp decompress OTA.aic



OTA_restored.drawio




aicomp benchmark




Recognition Rate : 99.2%

Compression Ratio : 41.7x

False Positive : 0




---


# Long-term Ideas




Wire compression


Text dictionary compression


Hierarchical cell recognition


Subcircuit discovery


Machine-learning-assisted matcher


OASIS exporter


SVG exporter


Cadence schematic exporter
