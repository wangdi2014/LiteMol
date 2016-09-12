/*
 * Copyright (c) 2016 David Sehnal, licensed under Apache 2.0, See LICENSE file for more info.
 */

namespace LiteMol.Viewer.DataSources { 
    export const DownloadMolecule = LiteMol.Bootstrap.Entity.Transformer.Molecule.downloadMoleculeSource({ 
        sourceId: 'url-molecule', 
        name: 'Url', 
        description: 'Download a molecule from the specified Url (if the host server supports cross domain requests).',  
        defaultId: 'http://webchemdev.ncbr.muni.cz/CoordinateServer/1tqn/cartoon',
        urlTemplate: id => id,
        isFullUrl: true
    });       
}