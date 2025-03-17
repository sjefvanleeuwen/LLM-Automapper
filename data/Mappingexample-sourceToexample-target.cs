Here is the C# code based on the provided field mappings and JSON schema representations for both source and target structures:

```csharp
using System;
using AutoMapper;

// Define classes for source structure
public class CustomerInfo
{
    public string customerId { get; set; }
    public string firstName { get; set; }
    public string lastName { get; set; }
    public string email { get; set; }
    public string phoneNumber { get; set; }
    public Address address { get; set; }
}

public class OrderDetails
{
    public string orderId { get; set; }
    public DateTime orderDate { get; set; }
    public List<OrderItem> items { get; set; }
    public decimal totalAmount { get; set; }
    public string paymentMethod { get; set; }
}

public class OrderItem
{
    public string productId { get; set; }
    public string productName { get; set; }
    public int quantity { get; set; }
    public decimal unitPrice { get; set; }
}

public class Address
{
    public string street { get; set; }
    public string city { get; set; }
    public string state { get; set; }
    public string zip { get; set; }
    public string country { get; set; }
}

// Define classes for target structure
public class Client
{
    public string id { get; set; }
    public Name name { get; set; }
    public ContactInfo contactInfo { get; set; }
}

public class Name
{
    public string first { get; set; }
    public string last { get; set; }
}

public class ContactInfo
{
    public string emailAddress { get; set; }
    public string phone { get; set; }
    public MailingAddress mailingAddress { get; set; }
}

public class MailingAddress
{
    public string addressLine1 { get; set; }
    public string city { get; set; }
    public string stateProvince { get; set; }
    public string postalCode { get; set; }
    public string countryRegion { get; set; }
}

public class Purchase
{
    public string purchaseId { get; set; }
    public DateTime purchaseTimestamp { get; set; }
    public List<Product> products { get; set; }
    public decimal purchaseTotal { get; set; }
    public string paymentType { get; set; }
}

public class Product
{
    public string id { get; set; }
    public string description { get; set; }
    public int count { get; set; }
    public decimal price { get; set; }
}

// Define AutoMapper profile
public class MappingProfile : Profile
{
    public MappingProfile()
    {
        CreateMap<CustomerInfo, Client>();
        CreateMap<OrderItem, Product>();
    }
}

// Sample implementation using the mapper
using (var mapper = new Mapper(new MappingProfile()))
{
    var customerInfo = new CustomerInfo
    {
        // Initialize source structure properties here
    };

    var target = mapper.Map<Client>(customerInfo);

    // Use the mapped target structure as needed
}
```

This C# code includes classes for both the source and target structures, along with an AutoMapper profile that configures the mappings. It also includes a sample implementation showing how to use the mapper.

Remember to include necessary using statements at the beginning of your .NET project file.