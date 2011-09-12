// File:   StanbolService.js
// Author: <a href="mailto:sebastian.germesin@dfki.de">Sebastian Germesin</a>
// Author: <a href="mailto:szaby.gruenwald@salzburgresearch.at">Szaby Gruenwald</a>
//
(function(){
Zart.prototype.StanbolService = function(options) {
    var defaults = {
        url: 'http://dev.iks-project.eu:8080/',
        defaultProxyUrl : "../utils/proxy/proxy.php"
    };
    this.options = jQuery.extend(defaults, options);

    this.zart = null;
    this.name = 'stanbol';
    this.connector = new StanbolConnector(this.options);
    Zart.prototype.StanbolService.prototype.init(this);
    jQuery.ajaxSetup({
        converters: {"text application/rdf+json": function(s){return JSON.parse(s);}}
    });

};

Zart.prototype.StanbolService.prototype = {
    init: function(){
        this.namespaces = {
            semdeski : "http://www.semanticdesktop.org/ontologies/2007/01/19/nie#",
            owl : "http://www.w3.org/2002/07/owl#",
            geonames : "http://www.geonames.org/ontology#",
            enhancer : "http://fise.iks-project.eu/ontology/",
            entityhub: "http://www.iks-project.eu/ontology/rick/model/",
            rdfs: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
            dc  : 'http://purl.org/dc/terms/',
            foaf: 'http://xmlns.com/foaf/0.1/',
            schema: 'http://schema.org/'
        };
        this.rules = [
            //rule to add backwards-relations to the triples
            //this makes querying for entities a lot easier!
            {'left' : [
                '?subject a <http://fise.iks-project.eu/ontology/EntityAnnotation>',
                '?subject enhancer:entity-type ?type',
                '?subject enhancer:confidence ?confidence',
                '?subject enhancer:entity-reference ?entity',
                '?subject dc:relation ?relation',
                '?relation a <http://fise.iks-project.eu/ontology/TextAnnotation>',
                '?relation enhancer:selected-text ?selected-text',
                '?relation enhancer:selection-context ?selection-context',
                '?relation enhancer:start ?start',
                '?relation enhancer:end ?end'
            ],
             'right' : [
                 '?entity a ?type',
                 '?entity enhancer:hasTextAnnotation ?relation',
                 '?entity enhancer:hasEntityAnnotation ?subject'
             ]
             },
             //rule to transform a Stanbol person into a Zart person
             {
                'left' : [
                    '?subject a <http://dbpedia.org/ontology/Person>',
                 ],
                 'right': function(ns){
                     return function(){
                         return jQuery.rdf.triple(this.subject.toString() +
                         ' a <http://schema.org/Person>', {
                             namespaces: ns
                         });
                     };
                 }(this.namespaces)
             }
        ];
    },
    // Zart API analyze implementation
    analyze: function(analyzable) {
        var service = this;

        var correct = analyzable instanceof this.zart.Analyzable;
        if (!correct) {throw "Invalid Analyzable passed";}

        var element = analyzable.options.element ? analyzable.options.element : jQuery('body');

        var text = service._extractText(element);

        if (text.length > 0) {
            var service = this;
            //query enhancer with extracted text
            var success = function (results) {
                var entities = service._enhancer2Entities(service, results);
                analyzable.resolve(entities);
            };
            var error = function (e) {
                analyzable.reject(e);
            };

            this.connector.analyze(text, success, error);

        } else {
            console.warn("No text found in element.");
            analyzable.resolve([]);
        }

    },
    
    // Zart API load implementation
    // Runs a Stanbol entityhub find
    find: function(findable){
        var correct = findable instanceof this.zart.Findable;
        if (!correct) {throw "Invalid Findable passed";}
        var service = this;
        // The term to find, * as wildcard allowed
        var term = escape(findable.options.term);
        if(!term){
            console.warn("StanbolConnector: No term to look for!");
            findable.resolve([]);
        };
        var limit = (typeof findable.options.limit === "undefined") ? 20 : findable.options.limit;
        var offset = (typeof findable.options.offset === "undefined") ? 0 : findable.options.offset;
        var success = function (results) {
            findable.resolve(results.results);
        };
        var error = function (e) {
            findable.reject(e);
        };
        this.connector.find(term, limit, offset, success, error)
    },
    
    // Zart API load implementation
    // Runs a Stanbol entityhub find
    load: function(loadable){
        var correct = loadable instanceof this.zart.Loadable;
        if (!correct) {throw "Invalid Loadable passed";}
        var service = this;
        
        var entity = loadable.options.entity;
        if(!entity){
            console.warn("StanbolConnector: No entity to look for!");
            loadable.resolve([]);
        };
        var success = function (results) {
            loadable.resolve(results.results);
        };
        var error = function (e) {
            loadable.reject(e);
        };
        this.connector.load(entity, success, error)
    },
    
    _extractText: function (element) {
        if (element.get(0) && 
            element.get(0).tagName && 
            (element.get(0).tagName == 'TEXTAREA' ||
            element.get(0).tagName == 'INPUT' && element.attr('type', 'text'))) {
            return element.get(0).val();
        }
        else {
            return element
                .text()    //get the text of element
                .replace(/\s+/g, ' ') //collapse multiple whitespaces
                .replace(/\0\b\n\r\f\t/g, '').trim(); // remove non-letter symbols
        }
    },

    _enhancer2Entities: function (service, results) {
        //transform data from Stanbol into Zart.Entities

        if (typeof jQuery.rdf !== 'function') {
            throw "RdfQuery is not loaded";
        }
        var rdf = jQuery.rdf().load(results, {});

        //execute rules here!
        if (service.rules) {
            var rules = jQuery.rdf.ruleset();
            for (var prefix in service.namespaces) {
                rules.prefix(prefix, service.namespaces[prefix]);
            }
            for (var i = 0; i < service.rules.length; i++) {
                rules.add(service.rules[i]['left'], service.rules[i]['right']);
            }
            rdf = rdf.reason(rules, 10); // execute the rules only 10 times to avoid looping
        }
        var entities = {};
        rdf.where('?subject ?property ?object').each(function() {
            var subject = this.subject.toString();
            if (!entities[subject]) {
                entities[subject] = {
                    '@subject': subject,
                    '@context': service.namespaces,
                    '@type': []
                };
            }
            var propertyUri = this.property.toString();

            var propertyCurie = jQuery.createCurie(propertyUri.substring(1, propertyUri.length - 1), {namespaces: service.namespaces});
            entities[subject][propertyCurie] = entities[subject][propertyCurie] || [];

            function getValue(rdfQueryLiteral){
                if(typeof rdfQueryLiteral.value === "string"){
                    return rdfQueryLiteral.value;
                } else if (rdfQueryLiteral.value._string){
                    return rdfQueryLiteral.toString();
                } else {
                    return rdfQueryLiteral.value
                }
            }
            entities[subject][propertyCurie].push(getValue(this.object));
        });

        _(entities).each(function(ent){
            ent["@type"] = ent["@type"].concat(ent["rdfs:type"]);
            delete ent["rdfs:type"];
            _(ent).each(function(value, property){
                if(value.length === 1){
                    ent[property] = value[0];
                }
            })
        })

        var zartEntities = [];
        jQuery.each(entities, function() {
            var entityInstance = new service.zart.Entity(this);
            entityInstance = service.zart.entities.addOrUpdate(entityInstance);
            zartEntities.push(entityInstance);
        });
        return zartEntities; 
    }
};

var StanbolConnector = function(options){
    this.options = options;
    this.baseUrl = options.url.replace(/\/$/, '');
    this.enhancerUrlPrefix = "/engines";
    this.entityhubUrlPrefix = "/entityhub";
    //TODO: this.ontonetUrlPrefix = "/ontonet";
    //TODO: this.rulesUrlPrefix = "/rules";
    //TODO: this.factstoreUrlPrefix = "/factstore";
};
StanbolConnector.prototype = {
    
    analyze: function(text, success, error, options) {
        if (!options) { options = {}; }
        var enhancerUrl = this.baseUrl + this.enhancerUrlPrefix;
        var proxyUrl = this._proxyUrl();
        var format = options.format || "application/rdf+json";
        
        jQuery.ajax({
            success: function(response){
                success(response)
            },
            error: error,
            type: "POST",
            url: proxyUrl || enhancerUrl,
            data: (proxyUrl) ? {
                    proxy_url: enhancerUrl, 
                    content: text,
                    verb: "POST",
                    format: format,
                } : text,
            dataType: format,
            contentType: proxyUrl ? undefined : "text/plain",
            accepts: {"application/rdf+json": "application/rdf+json"}

        });
    },
    
    load: function (uri, success, error, options) {
        if (!options) { options = {}; }
        var url = this.baseUrl + this.entityhubUrlPrefix + "/sites/entity?id=" + uri
        var proxyUrl = this._proxyUrl();
        var format = options.format || "application/rdf+json";
        
        jQuery.ajax({
            success: function(response){
                success(response)
            },
            error: error,
            type: (proxyUrl) ? "POST" : "GET",
            url: proxyUrl || url,
            data: (proxyUrl) ? {
                    proxy_url: url, 
                    content: "",
                    verb: "GET",
                    format: format
                } : text,
            dataType: format,
            contentType: proxyUrl ? undefined : "text/plain",
            accepts: {"application/rdf+json": "application/rdf+json"}
        });
    },
    
    find: function (term, limit, offset, success, error, options) {
        // curl -X POST -d "name=Bishofsh&limit=10&offset=0" http://localhost:8080/entityhub/sites/find
        if (!options) { options = {}; }
        if (offset == null) {
            offset = 0;
        }
        if (limit == null) {
            limit = 10;
        }
        
        var url = this.baseUrl + this.entityhubUrlPrefix + "/sites/find";
        var proxyUrl = this._proxyUrl();
        var format = options.format || "application/rdf+json";
        
        jQuery.ajax({
            success: function(response){
                success(response)
            },
            error: error,
            type: "POST",
            url: proxyUrl || url,
            data: (proxyUrl) ? {
                    proxy_url: url, 
                    content: {
                        name : term,
                        limit : limit,
                        offset: offset
                    },
                    verb: "POST",
                    format: format,
                    type: "text/plain"
                } : "name=" + term + "&limit=" + limit + "&offset=" + offset,
            dataType: format,
            contentType: proxyUrl ? undefined : "text/plain",
            accepts: {"application/rdf+json": "application/rdf+json"}
        });
    },
    
    _proxyUrl: function(){
        this.proxyUrl = "";
        if(this.baseUrl.indexOf(":") !== -1){
            return this.options.proxyUrl || this.options.defaultProxyUrl;
        } else {
            return '';
        }
    }
}
})();

